import { randomUUID } from "node:crypto";
import type {
  AgentRunRequest,
  AgentRuntime,
  EventStore,
  RunRecord,
  RunRecordStatus,
  RunRepository,
  ToolDenialSink,
} from "@friday/application";
import { heldReasonFor } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import type { RunContext, RunRecorder } from "./run-recorder.ts";

export type RunRecordingDeps = {
  runs: RunRepository;
  recorder: RunRecorder;
  newRunId?: () => string;
  runtimeFor?: (ctx: RunContext, sink: ToolDenialSink) => AgentRuntime;
};

export const NO_RUNTIME_MESSAGE = "Nenhum runtime configurado para a run.";

/** The run's base runtime: `runtimeFor` when present, else the fallback; throws when neither exists. */
export function baseRuntimeOf(
  recording: Pick<RunRecordingDeps, "runtimeFor" | "recorder">,
  ctx: RunContext,
  fallback: AgentRuntime | undefined,
): AgentRuntime {
  if (recording.runtimeFor) return recording.runtimeFor(ctx, recording.recorder.denialSink(ctx));
  if (fallback === undefined) throw new Error(NO_RUNTIME_MESSAGE);
  return fallback;
}

export type RegistrationEnv = {
  projectId: string;
  now: () => string;
  events: EventStore;
  runtime?: AgentRuntime;
  buildRequest: (issueId: number, runId?: string) => AgentRunRequest;
  recording: RunRecordingDeps;
  logError: (message: string, error: unknown) => void;
  onRuntimeFailure?: () => void;
};

export type RegisteredRun = {
  ctx: RunContext;
  row: RunRecord;
  request: AgentRunRequest;
  runtime: AgentRuntime;
};

export function statusFor(finished: RunFinished): RunRecordStatus {
  return finished.status === "succeeded" ? "succeeded" : "failed";
}

/** Saves the running row, picks the runtime and appends RunDispatched (so a failing runtimeFor leaves no dangling event). Throws when the run must not start. */
export function beginRun(env: RegistrationEnv, issueId: number): RegisteredRun {
  const { recording } = env;
  const runId = (recording.newRunId ?? randomUUID)();
  const request = env.buildRequest(issueId, runId);
  const ctx: RunContext = { runId, issueId, maxBudgetUsd: request.agent.maxBudgetUsd };
  const row: RunRecord = {
    id: runId,
    projectId: env.projectId,
    issueId,
    phase: null,
    startedAt: env.now(),
    finishedAt: null,
    status: "running",
  };
  recording.runs.save(row);
  try {
    const runtime = baseRuntimeOf(recording, ctx, env.runtime);
    env.events.append({
      projectId: env.projectId,
      issueId,
      runId,
      type: "RunDispatched",
      payload: {},
      actor: "daemon",
      at: env.now(),
    });
    return { ctx, row, request, runtime };
  } catch (error) {
    try {
      recording.runs.save({ ...row, status: "failed", finishedAt: env.now() });
    } catch (saveError) {
      env.logError(`Failed to finish run ${runId}`, saveError);
    }
    throw error;
  }
}

function notifyFailure(env: RegistrationEnv, runId: string): void {
  try {
    env.onRuntimeFailure?.();
  } catch (error) {
    env.logError(`Failed to record breaker failure for run ${runId}`, error);
  }
}

/** Writes the ceiling as unknown cost; a failure here is only logged. */
function recordCeiling(env: RegistrationEnv, ctx: RunContext): void {
  try {
    env.recording.recorder.recordUnknownCost(ctx);
  } catch (ledgerError) {
    env.logError(`Failed to record cost of run ${ctx.runId}`, ledgerError);
  }
}

/** Runs the registered run and always closes its row, whatever the runtime or recorder do. */
export async function completeRun(env: RegistrationEnv, run: RegisteredRun): Promise<void> {
  const { ctx } = run;
  let status: RunRecordStatus = "failed";
  try {
    const finished = await run.runtime.run(run.request);
    status = statusFor(finished);
    try {
      env.recording.recorder.recordFinished(ctx, finished);
    } catch (error) {
      env.logError(`Failed to record run ${ctx.runId}`, error);
      recordCeiling(env, ctx);
    }
    if (heldReasonFor(finished) === "RuntimeFailed") notifyFailure(env, ctx.runId);
  } catch (error) {
    env.logError(`Run failed for issue ${ctx.issueId}`, error);
    recordCeiling(env, ctx);
    notifyFailure(env, ctx.runId);
  }
  try {
    env.recording.runs.save({ ...run.row, status, finishedAt: env.now() });
  } catch (error) {
    env.logError(`Failed to finish run ${ctx.runId}`, error);
  }
}
