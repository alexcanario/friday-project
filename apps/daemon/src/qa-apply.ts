import type { QaStepOutcome } from "@friday/application";
import { applyInput, type RunRecorderDeps } from "./run-recorder.ts";

export type QaApplyResult = { applied: boolean; feedback: string | null };

/** Applies the QA step outcome to the persisted issue state. */
export function applyQaOutcome(
  deps: RunRecorderDeps,
  ctx: { issueId: number; runId: string | null },
  outcome: QaStepOutcome,
): QaApplyResult {
  if (!applyInput(deps, ctx, outcome.input)) return { applied: false, feedback: null };
  const feedback =
    outcome.input.type === "QaFailed" && "feedback" in outcome ? outcome.feedback : null;
  return { applied: true, feedback };
}
