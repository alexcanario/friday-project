import { randomUUID } from "node:crypto";
import {
  runTriageStep,
  type AgentRunRequest,
  type AgentRuntime,
  type GitHubPort,
  type IssueSummary,
} from "@friday/application";
import type { AgentConfig, RunFinished } from "@friday/contracts";
import { passesBudget, type BudgetCaps, type BudgetDeps } from "./budget-gate.ts";
import { applyInput, snapshotOf, type RunContext, type RunRecorderDeps } from "./run-recorder.ts";
import { statusFor, type RunRecordingDeps } from "./run-registration.ts";

export type TriageFlow = { model: AgentConfig["model"]; maxBudgetUsd: number };
export type TriageResult = { applied: boolean; feedback: null };

export type TriageDispatchDeps = {
  projectId: string;
  github: Pick<GitHubPort, "addLabel" | "postAgentComment">;
  runtime: AgentRuntime;
  readFlow: () => TriageFlow | null;
  readCaps: () => BudgetCaps | null;
  request: (issue: IssueSummary, flow: TriageFlow) => AgentRunRequest;
  recorder: RunRecorderDeps;
  recording: RunRecordingDeps;
  budget: BudgetDeps;
  now: () => Date;
  log?: (message: string) => void;
};

const NOT_APPLIED: TriageResult = { applied: false, feedback: null };

/** Wraps the runtime: the run row appears on the first call and every finish reaches the ledger. */
function recordingRuntime(deps: TriageDispatchDeps, ctx: RunContext) {
  const { runs, recorder } = deps.recording;
  const row = {
    id: ctx.runId,
    projectId: deps.projectId,
    issueId: ctx.issueId,
    phase: null,
    startedAt: deps.now().toISOString(),
    finishedAt: null,
  };
  let started = false;
  let last: RunFinished | null = null;
  const runtime: AgentRuntime = {
    run: async (request) => {
      if (!started) {
        runs.save({ ...row, status: "running" });
        started = true;
      }
      const base = deps.recording.runtimeFor
        ? deps.recording.runtimeFor(ctx, recorder.denialSink(ctx))
        : deps.runtime;
      let finished: RunFinished;
      try {
        finished = await base.run(request);
      } catch (error) {
        recorder.recordUnknownCost(ctx);
        throw error;
      }
      last = finished;
      recorder.recordFinished(ctx, finished, { applyHeld: false });
      return finished;
    },
  };
  const close = (): void => {
    if (!started) return;
    const status = last === null ? "failed" : statusFor(last);
    try {
      runs.save({ ...row, status, finishedAt: deps.now().toISOString() });
    } catch (error) {
      deps.log?.(`Falha ao fechar a run ${ctx.runId}: ${String(error)}`);
    }
  };
  return { runtime, close };
}

async function execute(
  deps: TriageDispatchDeps,
  issue: IssueSummary,
  state: "Todo" | "Triage",
  flow: TriageFlow,
): Promise<TriageResult> {
  const runId = (deps.recording.newRunId ?? randomUUID)();
  const ctx: RunContext = { runId, issueId: issue.number, maxBudgetUsd: flow.maxBudgetUsd };
  const wrapped = recordingRuntime(deps, ctx);
  try {
    const outcome = await runTriageStep(
      { runtime: wrapped.runtime, github: deps.github },
      { issue, state, request: deps.request(issue, flow), flow },
    );
    if (outcome.criteria !== null) {
      deps.recorder.events.append({
        projectId: deps.projectId,
        issueId: issue.number,
        runId,
        type: "CriteriaSet",
        payload: { criteria: outcome.criteria },
        actor: "daemon",
        at: deps.now().toISOString(),
      });
    }
    for (const input of outcome.inputs) {
      if (!applyInput(deps.recorder, { issueId: issue.number, runId }, input)) {
        deps.log?.(`Entrada ${input.type} recusada para a issue ${issue.number}`);
        return NOT_APPLIED;
      }
    }
    return { applied: true, feedback: null };
  } finally {
    wrapped.close();
  }
}

/** Runs the triage step for one issue in Todo or Triage and records the outcome. Never rejects. */
export async function runTriageForIssue(
  deps: TriageDispatchDeps,
  issue: IssueSummary,
): Promise<TriageResult> {
  try {
    const flow = deps.readFlow();
    const caps = deps.readCaps();
    if (flow === null || caps === null) {
      deps.log?.(
        `Falha na triagem da issue ${issue.number}: O factory.yaml está inválido ou ausente.`,
      );
      return NOT_APPLIED;
    }
    const row = deps.recorder.issues.get(deps.projectId, issue.number);
    const snapshot = row === null ? null : snapshotOf(row);
    const state = snapshot?.state;
    if (state !== "Todo" && state !== "Triage") return NOT_APPLIED;
    const allowed = passesBudget(
      deps.budget,
      caps,
      {
        projectId: deps.projectId,
        issueId: issue.number,
        runCeilingUsd: flow.maxBudgetUsd,
        nowMs: deps.now().getTime(),
      },
      deps.log ?? (() => {}),
    );
    if (!allowed) return NOT_APPLIED;
    return await execute(deps, issue, state, flow);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    deps.log?.(`Falha na triagem da issue ${issue.number}: ${text}`);
    return NOT_APPLIED;
  }
}
