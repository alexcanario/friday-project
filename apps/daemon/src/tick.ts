import type { AgentRunRequest, AgentRuntime, EventStore } from "@friday/application";
import type { RunRecorderDeps } from "./run-recorder.ts";
import type { BudgetDeps } from "./budget-gate.ts";
import type { RunRecordingDeps } from "./run-registration.ts";
import { dispatchIssue } from "./tick-dispatch.ts";
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

type TickerBaseDeps = {
  projectId: string;
  clock: Clock;
  readConfig: () => TickConfig | null;
  issues: ReadyIssueSource;
  buildRequest: RunRequestBuilder;
  runtime?: AgentRuntime;
  events: EventStore;
  log?: (message: string) => void;
  breaker?: {
    breaker: { isOpen(): boolean; recordFailure(): void };
    recorderDeps: RunRecorderDeps;
  };
};

/** Recording needs the budget caps: both are present or neither is. */
export type TickerDeps = TickerBaseDeps &
  (
    | { recording: RunRecordingDeps; budget: BudgetDeps }
    | { recording?: undefined; budget?: undefined }
  );

export interface Ticker {
  tick(): Promise<void>;
  idle(): Promise<void>;
  start(): () => void;
}

export function createTicker(deps: TickerDeps): Ticker {
  const active = new Map<number, Promise<void>>();

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
      dispatchIssue(deps, active, issueId, config);
    }
  }

  async function idle(): Promise<void> {
    while (active.size > 0) await Promise.all([...active.values()]);
  }

  function start(): () => void {
    let inFlight = false;
    const safeTick = (): void => {
      if (inFlight) return;
      inFlight = true;
      tick()
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };
    safeTick();
    return deps.clock.every(TICK_INTERVAL_MS, safeTick);
  }

  return { tick, idle, start };
}
