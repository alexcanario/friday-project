import type { AgentRunRequest, AgentRuntime, EventStore } from "@friday/application";
import type { TickConfig } from "./tick-config.ts";

export const TICK_INTERVAL_MS = 30000;

export interface Clock {
  now(): number;
  every(ms: number, fn: () => void): () => void;
}

export interface ReadyIssueSource {
  listReady(): Promise<number[]>;
}

export type RunRequestBuilder = (issueId: number) => AgentRunRequest;

export interface TickerDeps {
  projectId: string;
  clock: Clock;
  readConfig: () => TickConfig | null;
  issues: ReadyIssueSource;
  buildRequest: RunRequestBuilder;
  runtime: AgentRuntime;
  events: EventStore;
}

export interface Ticker {
  tick(): Promise<void>;
  idle(): Promise<void>;
  start(): () => void;
}

export function createTicker(deps: TickerDeps): Ticker {
  const active = new Map<number, Promise<void>>();

  function dispatch(issueId: number): void {
    const run = Promise.resolve()
      .then(() => deps.runtime.run(deps.buildRequest(issueId)))
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => active.delete(issueId));
    active.set(issueId, run);
    deps.events.append({
      projectId: deps.projectId,
      issueId,
      runId: null,
      type: "RunDispatched",
      payload: {},
      actor: "daemon",
      at: new Date(deps.clock.now()).toISOString(),
    });
  }

  async function tick(): Promise<void> {
    const config = deps.readConfig();
    if (config === null || !config.enabled) return;
    const ready = await deps.issues.listReady();
    const slots = config.maxConcurrentRuns - active.size;
    for (const issueId of ready.filter((id) => !active.has(id)).slice(0, Math.max(0, slots))) {
      dispatch(issueId);
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
