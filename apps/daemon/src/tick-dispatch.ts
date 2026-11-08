import type { AgentRunRequest } from "@friday/application";
import { applyInput } from "./run-recorder.ts";
import { passesBudget, type BudgetDeps } from "./budget-gate.ts";
import {
  NO_RUNTIME_MESSAGE,
  beginRun,
  completeRun,
  type RunRecordingDeps,
} from "./run-registration.ts";
import type { TickConfig } from "./tick-config.ts";
import type { TickerDeps } from "./tick.ts";

export type ActiveRuns = Map<number, Promise<void>>;

const isoOf = (deps: TickerDeps): string => new Date(deps.clock.now()).toISOString();

function logError(deps: TickerDeps, message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  deps.log?.(`${message}: ${detail}`);
}

function withinBudget(
  deps: TickerDeps,
  budget: BudgetDeps,
  issueId: number,
  config: TickConfig,
): boolean {
  return passesBudget(
    budget,
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

/** True when the breaker lets the run start; otherwise holds the issue with BreakerOpen. Throws when the state cannot be read. */
function passesBreaker(deps: TickerDeps, issueId: number): boolean {
  if (!deps.breaker || !deps.breaker.breaker.isOpen()) return true;
  const held = applyInput(
    deps.breaker.recorderDeps,
    { issueId, runId: null },
    { type: "RunHeld", reason: "BreakerOpen" },
  );
  if (!held) deps.log?.(`Breaker open for issue ${issueId} but RunHeld was not accepted`);
  return false;
}

function dispatchRecorded(
  deps: TickerDeps,
  active: ActiveRuns,
  issueId: number,
  recording: RunRecordingDeps,
  budget: BudgetDeps,
  config: TickConfig,
): void {
  const env = {
    projectId: deps.projectId,
    now: () => isoOf(deps),
    events: deps.events,
    ...(deps.runtime === undefined ? {} : { runtime: deps.runtime }),
    buildRequest: deps.buildRequest,
    recording,
    logError: (message: string, error: unknown) => logError(deps, message, error),
    ...(deps.breaker ? { onRuntimeFailure: () => deps.breaker?.breaker.recordFailure() } : {}),
  };
  let registered;
  try {
    if (!passesBreaker(deps, issueId)) return;
    if (!withinBudget(deps, budget, issueId, config)) return;
    registered = beginRun(env, issueId);
  } catch (error) {
    logError(deps, `Failed to dispatch issue ${issueId}`, error);
    return;
  }
  active.set(
    issueId,
    completeRun(env, registered).finally(() => active.delete(issueId)),
  );
}

function dispatchPlain(deps: TickerDeps, active: ActiveRuns, issueId: number): void {
  const { runtime } = deps;
  let request: AgentRunRequest;
  try {
    if (runtime === undefined) throw new Error(NO_RUNTIME_MESSAGE);
    request = deps.buildRequest(issueId);
    deps.events.append({
      projectId: deps.projectId,
      issueId,
      runId: null,
      type: "RunDispatched",
      payload: {},
      actor: "daemon",
      at: isoOf(deps),
    });
  } catch (error) {
    logError(deps, `Failed to dispatch issue ${issueId}`, error);
    return;
  }
  const run = Promise.resolve()
    .then(() => runtime.run(request))
    .then(
      () => undefined,
      (error: unknown) => logError(deps, `Run failed for issue ${issueId}`, error),
    )
    .finally(() => active.delete(issueId));
  active.set(issueId, run);
}

export function dispatchIssue(
  deps: TickerDeps,
  active: ActiveRuns,
  issueId: number,
  config: TickConfig,
): void {
  if (deps.recording) {
    return dispatchRecorded(deps, active, issueId, deps.recording, deps.budget, config);
  }
  dispatchPlain(deps, active, issueId);
}
