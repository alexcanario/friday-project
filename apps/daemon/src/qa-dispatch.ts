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
import type { RunRecorderDeps } from "./run-recorder.ts";
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

/** Runs the QA step with a registered run row and a recording runtime, then applies the outcome. */
async function execute(
  deps: QaDispatchDeps,
  issueId: number,
  runId: string,
  input: QaStepInput,
): Promise<QaApplyResult> {
  const { runs, recorder } = deps.recording;
  const row = {
    id: runId,
    projectId: deps.projectId,
    issueId,
    phase: null,
    startedAt: deps.now().toISOString(),
    finishedAt: null,
  };
  runs.save({ ...row, status: "running" });
  let last: RunFinished | null = null;
  let held = false;
  try {
    const base = baseRuntimeOf(deps.recording, { runId, issueId }, deps.step.runtime);
    const runtime: AgentRuntime = {
      run: async (request) => {
        const finished = await base.run(request);
        last = finished;
        recorder.recordFinished(
          { runId, issueId, maxBudgetUsd: input.request.agent.maxBudgetUsd },
          finished,
        );
        return finished;
      },
    };
    const outcome = await runQaStep({ ...deps.step, runtime }, input);
    held = outcome.input.type === "RunHeld";
    const result = applyQaOutcome(deps.recorder, { issueId, runId }, outcome);
    if (result.applied && outcome.input.type === "QaFailed") {
      appendQaFailed(deps, { issueId, runId }, result.feedback);
    }
    return result;
  } finally {
    const done: RunFinished | null = last;
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
