import { randomUUID } from "node:crypto";
import {
  runSpecialistStep,
  type AgentRunRequest,
  type AgentRuntime,
  type EffectTool,
  type SpecialistStepDeps,
} from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import type { WorkflowSnapshot } from "@friday/domain";
import { passesBudget, type BudgetCaps, type BudgetDeps } from "./budget-gate.ts";
import { snapshotOf, type RunRecorderDeps } from "./run-recorder.ts";
import { baseRuntimeOf, statusFor, type RunRecordingDeps } from "./run-registration.ts";
import { applySpecialistOutcome } from "./specialist-apply.ts";
import { createPrOf } from "./pr-of.ts";
import {
  guardNoPush,
  HELD_BEFORE_RUN,
  resolveHeadFallback,
  type SpecialistHeadDeps,
} from "./specialist-head.ts";

export type SpecialistDispatchDeps = SpecialistHeadDeps & {
  projectId: string;
  targetOf: (issueId: number, runId: string) => AgentRunRequest | null;
  step: Omit<SpecialistStepDeps, "runtime"> & { runtime?: AgentRuntime };
  recorder: RunRecorderDeps;
  recording: RunRecordingDeps;
  budget: BudgetDeps;
  caps: BudgetCaps;
  now: () => Date;
  log?: (message: string) => void;
};

type Result = { applied: boolean; feedback: null };
const NOT_APPLIED: Result = { applied: false, feedback: null };

type StepOutcome = Awaited<ReturnType<typeof runSpecialistStep>>;
type RunContext = { runId: string; issueId: number; maxBudgetUsd: number };
type RunRow = {
  id: string;
  projectId: string;
  issueId: number;
  phase: null;
  startedAt: string;
  finishedAt: null;
};
type Tracker = { last: RunFinished | null };

type PrBox = { number: number | null };

/** Copies the request with `onPrCreated` and `onEffectError` hooks; `onPrCreated` keeps the last PR number in `box`; never mutates the original. */
function withRunHooks(
  request: AgentRunRequest,
  box: PrBox,
  onEffectError: (tool: EffectTool, error: unknown) => void,
): AgentRunRequest {
  const effects = request.friday?.effects;
  if (request.friday === undefined || effects === undefined) return request;
  const run = {
    ...effects.run,
    onPrCreated: (pr: number) => void (box.number = pr),
    onEffectError,
  };
  return { ...request, friday: { ...request.friday, effects: { ...effects, run } } };
}

function appendPrOpened(deps: SpecialistDispatchDeps, ctx: RunContext, number: number): void {
  try {
    deps.recorder.events.append({
      projectId: deps.projectId,
      issueId: ctx.issueId,
      runId: ctx.runId,
      type: "PrOpened",
      payload: { number },
      actor: "daemon",
      at: deps.recorder.now().toISOString(),
    });
  } catch (error) {
    deps.log?.(`Falha ao gravar PrOpened da issue ${ctx.issueId}: ${String(error)}`);
  }
}

/** Writes the ceiling as unknown cost; a failure here is only logged. */
function recordCeiling(deps: SpecialistDispatchDeps, ctx: RunContext): void {
  try {
    deps.recording.recorder.recordUnknownCost(ctx);
  } catch (ledgerError) {
    deps.log?.(`Falha ao registrar o custo da run ${ctx.runId}: ${String(ledgerError)}`);
  }
}

function recordingRuntime(
  deps: SpecialistDispatchDeps,
  ctx: RunContext,
  tracker: Tracker,
): AgentRuntime {
  const { recorder } = deps.recording;
  const base = baseRuntimeOf(deps.recording, ctx, deps.step.runtime);
  return {
    run: async (req) => {
      const finished = await base.run(req);
      tracker.last = finished;
      try {
        recorder.recordFinished(ctx, finished);
      } catch (error) {
        recordCeiling(deps, ctx);
        throw error;
      }
      return finished;
    },
  };
}

function appendWorkReported(
  deps: SpecialistDispatchDeps,
  ctx: RunContext,
  request: AgentRunRequest,
  outcome: StepOutcome,
): void {
  if (!("report" in outcome)) return;
  deps.recorder.events.append({
    projectId: deps.projectId,
    issueId: ctx.issueId,
    runId: ctx.runId,
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

function closeRun(
  deps: SpecialistDispatchDeps,
  row: RunRow,
  tracker: Tracker,
  held: boolean,
): void {
  const done = tracker.last;
  const status = done !== null && !held ? statusFor(done) : "failed";
  try {
    deps.recording.runs.save({ ...row, status, finishedAt: deps.now().toISOString() });
  } catch (error) {
    deps.log?.(`Falha ao fechar a run ${row.id}: ${String(error)}`);
  }
}

async function execute(
  deps: SpecialistDispatchDeps,
  issueId: number,
  runId: string,
  request: AgentRunRequest,
  snapshot: WorkflowSnapshot,
): Promise<Result> {
  const row: RunRow = {
    id: runId,
    projectId: deps.projectId,
    issueId,
    phase: null,
    startedAt: deps.now().toISOString(),
    finishedAt: null,
  };
  deps.recording.runs.save({ ...row, status: "running" });
  const ctx = { runId, issueId, maxBudgetUsd: request.agent.maxBudgetUsd };
  const tracker: Tracker = { last: null };
  let held = false;
  const box: PrBox = { number: null };
  try {
    const runtime = recordingRuntime(deps, ctx, tracker);
    const hooked = withRunHooks(request, box, (tool, error) =>
      deps.log?.(`Falha na ferramenta ${tool} da issue ${issueId}: ${String(error)}`),
    );
    const stepped = await runSpecialistStep(
      { ...deps.step, runtime },
      { request: hooked, snapshot },
    );
    const outcome = await guardNoPush(deps, request.cwd, request.headFallback, stepped);
    held = outcome.inputs.some((i) => i.type === "RunHeld");
    // Grava o PR antes de aplicar o desfecho: um lançamento no apply não pode perder um PR já aberto.
    if (tracker.last !== null && box.number !== null) appendPrOpened(deps, ctx, box.number);
    const result = applySpecialistOutcome(deps.recorder, { issueId, runId }, outcome);
    if (result.applied) appendWorkReported(deps, ctx, request, outcome);
    return { applied: result.applied, feedback: null };
  } catch (error) {
    // Só registra o teto quando o runtime lançou; se a run terminou, recordFinished já gravou o custo.
    if (tracker.last === null) recordCeiling(deps, ctx);
    throw error;
  } finally {
    closeRun(deps, row, tracker, held);
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
    const pr = createPrOf(deps.recorder.events, deps.projectId)(issueId);
    const fallback = await resolveHeadFallback(deps, issueId, pr, request.cwd);
    if (!fallback.ok) {
      deps.log?.(`Especialista da issue ${issueId} não rodou: ${fallback.reason}`);
      const held = applySpecialistOutcome(deps.recorder, { issueId, runId: null }, HELD_BEFORE_RUN);
      return { applied: held.applied, feedback: null };
    }
    return await execute(
      deps,
      issueId,
      runId,
      { ...request, headFallback: fallback.head },
      snapshot,
    );
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    deps.log?.(`Falha no especialista da issue ${issueId}: ${text}`);
    return NOT_APPLIED;
  }
}
