import { randomUUID } from "node:crypto";
import {
  runSpecialistStep,
  type AgentRunRequest,
  type AgentRuntime,
  type SpecialistStepDeps,
} from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import type { WorkflowSnapshot } from "@friday/domain";
import { passesBudget, type BudgetCaps, type BudgetDeps } from "./budget-gate.ts";
import { snapshotOf, type RunRecorderDeps } from "./run-recorder.ts";
import { statusFor, type RunRecordingDeps } from "./run-registration.ts";
import { applySpecialistOutcome } from "./specialist-apply.ts";

export type SpecialistDispatchDeps = {
  projectId: string;
  targetOf: (issueId: number, runId: string) => AgentRunRequest | null;
  step: SpecialistStepDeps;
  recorder: RunRecorderDeps;
  recording: RunRecordingDeps;
  budget: BudgetDeps;
  caps: BudgetCaps;
  now: () => Date;
  log?: (message: string) => void;
};

type Result = { applied: boolean; feedback: null };
const NOT_APPLIED: Result = { applied: false, feedback: null };

async function execute(
  deps: SpecialistDispatchDeps,
  issueId: number,
  runId: string,
  request: AgentRunRequest,
  snapshot: WorkflowSnapshot,
): Promise<Result> {
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
  const ctx = { runId, issueId, maxBudgetUsd: request.agent.maxBudgetUsd };
  let last: RunFinished | null = null;
  let held = false;
  try {
    const base: AgentRuntime = deps.recording.runtimeFor
      ? deps.recording.runtimeFor(ctx, recorder.denialSink(ctx))
      : deps.step.runtime;
    const runtime: AgentRuntime = {
      run: async (req) => {
        const finished = await base.run(req);
        last = finished;
        recorder.recordFinished(ctx, finished);
        return finished;
      },
    };
    const outcome = await runSpecialistStep({ ...deps.step, runtime }, { request, snapshot });
    held = outcome.inputs.some((i) => i.type === "RunHeld");
    const result = applySpecialistOutcome(deps.recorder, { issueId, runId }, outcome);
    if (result.applied && "report" in outcome) {
      deps.recorder.events.append({
        projectId: deps.projectId,
        issueId,
        runId,
        type: "WorkReported",
        payload: {
          worktreePath: request.cwd,
          headSha: outcome.report.headSha,
          changedFiles: outcome.report.changedFiles,
        },
        actor: "daemon",
        at: deps.recorder.now().toISOString(),
      });
    }
    return { applied: result.applied, feedback: null };
  } catch (error) {
    // Só registra o teto quando o runtime lançou; se a run terminou, recordFinished já gravou o custo.
    if (last === null) {
      try {
        recorder.recordUnknownCost(ctx);
      } catch (ledgerError) {
        deps.log?.(`Falha ao registrar o custo da run ${runId}: ${String(ledgerError)}`);
      }
    }
    throw error;
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

/** Runs the specialist for an issue in InProgress and applies the outcome. Never rejects. */
export async function runSpecialistForIssue(
  deps: SpecialistDispatchDeps,
  issueId: number,
): Promise<Result> {
  const runId = (deps.recording.newRunId ?? randomUUID)();
  try {
    const row = deps.recorder.issues.get(deps.projectId, issueId);
    const snapshot = row === null ? null : snapshotOf(row);
    if (snapshot === null) {
      deps.log?.(`A issue ${issueId} não tem linha válida para o especialista`);
      return NOT_APPLIED;
    }
    const request = deps.targetOf(issueId, runId);
    if (request === null) {
      deps.log?.(`A issue ${issueId} em InProgress não tem pedido para o especialista`);
      return NOT_APPLIED;
    }
    const ok = passesBudget(
      deps.budget,
      deps.caps,
      {
        projectId: deps.projectId,
        issueId,
        runCeilingUsd: request.agent.maxBudgetUsd,
        nowMs: deps.now().getTime(),
      },
      deps.log ?? (() => {}),
    );
    if (!ok) return NOT_APPLIED;
    return await execute(deps, issueId, runId, request, snapshot);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    deps.log?.(`Falha no especialista da issue ${issueId}: ${text}`);
    return NOT_APPLIED;
  }
}
