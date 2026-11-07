import type { AgentRunRequest, AgentRuntime, EventStore } from "@friday/application";
import { passesBudget, type BudgetDeps } from "./budget-gate.ts";
import { beginRun, completeRun, type RunRecordingDeps } from "./run-registration.ts";
import type { TickConfig } from "./tick-config.ts";

export const TICK_INTERVAL_MS = 30000;

export interface Clock {
  now(): number;
  every(ms: number, fn: () => void): () => void;
}

export interface ReadyIssueSource {
  listReady(capacity?: { active: number; max: number }): Promise<number[]>;
  /** Runs held outside the ticker (the Judge) that still occupy a slot (D68). */
  busy?(): number;
}

export type RunRequestBuilder = (issueId: number, runId?: string) => AgentRunRequest;

export interface TickerDeps {
  projectId: string;
  clock: Clock;
  readConfig: () => TickConfig | null;
  issues: ReadyIssueSource;
  buildRequest: RunRequestBuilder;
  runtime: AgentRuntime;
  events: EventStore;
  log?: (message: string) => void;
  recording?: RunRecordingDeps;
  budget?: BudgetDeps;
}

export interface Ticker {
  tick(): Promise<void>;
  idle(): Promise<void>;
  start(): () => void;
}

export function createTicker(deps: TickerDeps): Ticker {
  const active = new Map<number, Promise<void>>();

  function logError(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    deps.log?.(`${message}: ${detail}`);
  }

  const iso = (): string => new Date(deps.clock.now()).toISOString();

  function withinBudget(issueId: number, config: TickConfig): boolean {
    if (!deps.budget) return true;
    return passesBudget(
      deps.budget,
      config,
      {
        projectId: deps.projectId,
        issueId,
        runCeilingUsd: deps.buildRequest(issueId).agent.maxBudgetUsd,
        nowMs: deps.clock.now(),
      },
      (message) => deps.log?.(message),
    );
  }

  function dispatchRecorded(
    issueId: number,
    recording: RunRecordingDeps,
    config: TickConfig,
  ): void {
    const env = {
      projectId: deps.projectId,
      now: iso,
      events: deps.events,
      runtime: deps.runtime,
      buildRequest: deps.buildRequest,
      recording,
      logError,
    };
    let registered;
    try {
      if (!withinBudget(issueId, config)) return;
      registered = beginRun(env, issueId);
    } catch (error) {
      logError(`Failed to dispatch issue ${issueId}`, error);
      return;
    }
    active.set(
      issueId,
      completeRun(env, registered).finally(() => active.delete(issueId)),
    );
  }

  function dispatch(issueId: number, config: TickConfig): void {
    if (deps.recording) return dispatchRecorded(issueId, deps.recording, config);
    let request: AgentRunRequest;
    try {
      request = deps.buildRequest(issueId);
      deps.events.append({
        projectId: deps.projectId,
        issueId,
        runId: null,
        type: "RunDispatched",
        payload: {},
        actor: "daemon",
        at: new Date(deps.clock.now()).toISOString(),
      });
    } catch (error) {
      logError(`Failed to dispatch issue ${issueId}`, error);
      return;
    }
    const run = Promise.resolve()
      .then(() => deps.runtime.run(request))
      .then(
        () => undefined,
        (error: unknown) => logError(`Run failed for issue ${issueId}`, error),
      )
      .finally(() => active.delete(issueId));
    active.set(issueId, run);
  }

  async function tick(): Promise<void> {
    const config = deps.readConfig();
    if (config === null || !config.enabled) return;
    const ready = await deps.issues.listReady({
      active: active.size,
      max: config.maxConcurrentRuns,
    });
    const slots = config.maxConcurrentRuns - active.size - (deps.issues.busy?.() ?? 0);
    for (const issueId of [...new Set(ready)]
      .filter((id) => !active.has(id))
      .slice(0, Math.max(0, slots))) {
      dispatch(issueId, config);
    }
  }

  async function idle(): Promise<void> {
    while (active.size > 0) await Promise.all([...active.values()]);
  }

  function start(): () => void {
    const safeTick = (): void => {
      tick().catch(() => undefined);
    };
    safeTick();
    return deps.clock.every(TICK_INTERVAL_MS, safeTick);
  }

  return { tick, idle, start };
}
