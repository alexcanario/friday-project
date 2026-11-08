import { randomUUID } from "node:crypto";
import {
  runQaStep,
  type AgentRuntime,
  type QaStepDeps,
  type QaStepInput,
} from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import { passesBudget, type BudgetCaps, type BudgetDeps } from "./budget-gate.ts";
import { applyQaOutcome, type QaApplyResult } from "./qa-apply.ts";
import type { RunContext, RunRecorderDeps } from "./run-recorder.ts";
import { baseRuntimeOf, statusFor, type RunRecordingDeps } from "./run-registration.ts";

export type QaDispatchDeps = {
  projectId: string;
  targetOf: (issueId: number, runId: string) => QaStepInput | null;
  step: Omit<QaStepDeps, "runtime"> & { runtime?: AgentRuntime };
  recorder: RunRecorderDeps;
  recording: RunRecordingDeps;
  budget: BudgetDeps;
  caps: BudgetCaps;
  now: () => Date;
  log?: (message: string) => void;
};

const NOT_APPLIED: QaApplyResult = { applied: false, feedback: null };

function appendQaFailed(
  deps: QaDispatchDeps,
  ids: { issueId: number; runId: string },
  feedback: QaApplyResult["feedback"],
): void {
  deps.recorder.events.append({
    projectId: deps.projectId,
    issueId: ids.issueId,
    runId: ids.runId,
    type: "QaFinished",
    payload: { outcome: "qa_failed", feedback },
    actor: "daemon",
    at: deps.recorder.now().toISOString(),
  });
}

type Tracker = { last: RunFinished | null };

/** Writes the ceiling as unknown cost; a failure here is only logged. */
function recordCeiling(deps: QaDispatchDeps, ctx: RunContext): void {
  try {
    deps.recording.recorder.recordUnknownCost(ctx);
  } catch (ledgerError) {
    deps.log?.(`Falha ao registrar o custo da run ${ctx.runId}: ${String(ledgerError)}`);
  }
}

/** The run's runtime wrapped to record every finished run, or its ceiling when it throws. */
function recordingRuntime(
  deps: QaDispatchDeps,
  ctx: { runId: string; issueId: number; maxBudgetUsd: number },
  tracker: Tracker,
): AgentRuntime {
  const { recorder } = deps.recording;
  // runtimeFor and denialSink receive only the ids, never the ceiling (#259).
  const base = baseRuntimeOf(
    deps.recording,
    { runId: ctx.runId, issueId: ctx.issueId },
    deps.step.runtime,
  );
  return {
    run: async (request) => {
      let finished: RunFinished;
      try {
        finished = await base.run(request);
      } catch (error) {
        recordCeiling(deps, ctx);
        throw error;
      }
      tracker.last = finished;
      recorder.recordFinished(ctx, finished);
      return finished;
    },
  };
}

/** Runs the QA step with a registered run row and a recording runtime, then applies the outcome. */
async function execute(
  deps: QaDispatchDeps,
  issueId: number,
  runId: string,
  input: QaStepInput,
): Promise<QaApplyResult> {
  const { runs } = deps.recording;
  const row = {
    id: runId,
    projectId: deps.projectId,
    issueId,
    phase: null,
    startedAt: deps.now().toISOString(),
    finishedAt: null,
  };
  runs.save({ ...row, status: "running" });
  const tracker: Tracker = { last: null };
  let held = false;
  try {
    const ctx = { runId, issueId, maxBudgetUsd: input.request.agent.maxBudgetUsd };
    const runtime = recordingRuntime(deps, ctx, tracker);
    const outcome = await runQaStep({ ...deps.step, runtime }, input);
    held = outcome.input.type === "RunHeld";
    const result = applyQaOutcome(deps.recorder, { issueId, runId }, outcome);
    if (result.applied && outcome.input.type === "QaFailed") {
      appendQaFailed(deps, { issueId, runId }, result.feedback);
    }
    return result;
  } finally {
    const done = tracker.last;
    const status = done !== null && !held ? statusFor(done) : "failed";
    try {
      runs.save({ ...row, status, finishedAt: deps.now().toISOString() });
    } catch (error) {
      deps.log?.(`Falha ao fechar a run ${runId}: ${String(error)}`);
    }
  }
}

/** Runs QA for an issue in QA and records the verdict. Never rejects. */
export async function runQaForIssue(deps: QaDispatchDeps, issueId: number): Promise<QaApplyResult> {
  const runId = (deps.recording.newRunId ?? randomUUID)();
  try {
    const input = deps.targetOf(issueId, runId);
    if (input === null) {
      deps.log?.(`A issue ${issueId} em QA não tem entrada para o QA`);
      return NOT_APPLIED;
    }
    const allowed = passesBudget(
      deps.budget,
      deps.caps,
      {
        projectId: deps.projectId,
        issueId,
        runCeilingUsd: input.request.agent.maxBudgetUsd,
        nowMs: deps.now().getTime(),
      },
      deps.log ?? (() => {}),
    );
    if (!allowed) return NOT_APPLIED;
    return await execute(deps, issueId, runId, input);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    deps.log?.(`Falha no QA da issue ${issueId}: ${text}`);
    return NOT_APPLIED;
  }
}
