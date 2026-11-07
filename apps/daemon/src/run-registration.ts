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
import type { RunFinished } from "@friday/contracts";
import type { RunContext, RunRecorder } from "./run-recorder.ts";

export type RunRecordingDeps = {
  runs: RunRepository;
  recorder: RunRecorder;
  newRunId?: () => string;
  runtimeFor?: (ctx: RunContext, sink: ToolDenialSink) => AgentRuntime;
};

export type RegistrationEnv = {
  projectId: string;
  now: () => string;
  events: EventStore;
  runtime: AgentRuntime;
  buildRequest: (issueId: number, runId?: string) => AgentRunRequest;
  recording: RunRecordingDeps;
  logError: (message: string, error: unknown) => void;
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
  const ctx: RunContext = { runId, issueId };
  const request = env.buildRequest(issueId, runId);
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
    const runtime = recording.runtimeFor
      ? recording.runtimeFor(ctx, recording.recorder.denialSink(ctx))
      : env.runtime;
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
    }
  } catch (error) {
    env.logError(`Run failed for issue ${ctx.issueId}`, error);
  }
  try {
    env.recording.runs.save({ ...run.row, status, finishedAt: env.now() });
  } catch (error) {
    env.logError(`Failed to finish run ${ctx.runId}`, error);
  }
}
