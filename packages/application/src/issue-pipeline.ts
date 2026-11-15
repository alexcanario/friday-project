import {
  createWorkflow,
  transition,
  type IssueState,
  type WorkflowInput,
  type WorkflowSnapshot,
} from "@friday/domain";
import type { VariantOutcome } from "./eval-executor.ts";

export type PipelineStepKind = "specialist" | "qa" | "judge";
export type PipelineStepRequest = {
  step: PipelineStepKind;
  round: number;
  feedback: string | null;
  maxBudgetUsd: number;
};
export type PipelineStepResult = {
  inputs: WorkflowInput[];
  feedback: string | null;
  costUsd: number | null;
  peakContextTokens: number | null;
};

export interface PipelineSteps {
  run(request: PipelineStepRequest): Promise<PipelineStepResult>;
}

type Tally = {
  spentUsd: number;
  costKnown: boolean;
  peak: number | null;
  counts: Record<PipelineStepKind, number>;
  feedback: string | null;
};

const STEP_BY_STATE: Partial<Record<IssueState, PipelineStepKind>> = {
  InProgress: "specialist",
  QA: "qa",
  InReview: "judge",
};

const REPROVED = new Set<WorkflowInput["type"]>(["QaFailed", "ChangesRequested", "ReviewRejected"]);

function applyAll(
  snapshot: WorkflowSnapshot,
  inputs: readonly WorkflowInput[],
): WorkflowSnapshot | null {
  let current = snapshot;
  for (const input of inputs) {
    const outcome = transition(current, input);
    if (!outcome.ok) return null;
    current = outcome.value.snapshot;
  }
  return current;
}

function record(tally: Tally, result: PipelineStepResult, remainingUsd: number): void {
  if (result.costUsd === null) tally.costKnown = false;
  tally.spentUsd += result.costUsd ?? remainingUsd;
  const peak = result.peakContextTokens;
  if (peak !== null && (tally.peak === null || peak > tally.peak)) tally.peak = peak;
}

async function runStep(
  steps: PipelineSteps,
  snapshot: WorkflowSnapshot,
  kind: PipelineStepKind,
  remainingUsd: number,
  tally: Tally,
): Promise<WorkflowSnapshot | null> {
  tally.counts[kind] += 1;
  let result: PipelineStepResult;
  try {
    result = await steps.run({
      step: kind,
      round: tally.counts[kind],
      feedback: tally.feedback,
      maxBudgetUsd: remainingUsd,
    });
  } catch {
    return null;
  }
  record(tally, result, remainingUsd);
  if (result.inputs.length === 0) return null;
  const next = applyAll(snapshot, result.inputs);
  if (next === null) return null;
  if (kind !== "specialist" && result.inputs.some((input) => REPROVED.has(input.type))) {
    tally.feedback = result.feedback;
  }
  return next;
}

// Returns true when the Judge approved (RiskCheck). A broken step makes the cost unknown.
async function drive(steps: PipelineSteps, maxBudgetUsd: number, tally: Tally): Promise<boolean> {
  const created = createWorkflow("experiment");
  let snapshot = created.ok
    ? applyAll(created.value, [{ type: "Admitted" }, { type: "SpecialistAssigned" }])
    : null;
  while (snapshot !== null) {
    if (snapshot.state === "Verify") {
      snapshot = applyAll(snapshot, [{ type: "VerifyPassed" }]);
      continue;
    }
    const kind = STEP_BY_STATE[snapshot.state];
    if (kind === undefined) return snapshot.state === "RiskCheck";
    const remainingUsd = maxBudgetUsd - tally.spentUsd;
    if (remainingUsd <= 0) return false;
    snapshot = await runStep(steps, snapshot, kind, remainingUsd, tally);
  }
  tally.costKnown = false;
  return false;
}

export async function runIssuePipeline(
  deps: { steps: PipelineSteps; now: () => number },
  input: { maxBudgetUsd: number },
): Promise<VariantOutcome> {
  const startedAt = deps.now();
  const tally: Tally = {
    spentUsd: 0,
    costKnown: true,
    peak: null,
    counts: { specialist: 0, qa: 0, judge: 0 },
    feedback: null,
  };
  const done = await drive(deps.steps, input.maxBudgetUsd, tally);
  const endedAt = deps.now();
  return {
    status: done ? "done" : "failed",
    costUsd: tally.costKnown ? tally.spentUsd : null,
    rounds: tally.counts.qa + tally.counts.judge,
    judgeFirstRound: done && tally.counts.judge === 1,
    durationS: Math.round((endedAt - startedAt) / 1000),
    peakContextTokens: tally.peak,
  };
}
