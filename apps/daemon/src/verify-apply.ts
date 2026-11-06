import { applyInput, type RunRecorderDeps } from "./run-recorder.ts";
import type { VerifyStepOutcome } from "./verify-step.ts";

export type VerifyApplyResult = { applied: boolean; feedback: string | null };

/** Applies the Verify step outcome to the persisted issue state. */
export function applyVerifyOutcome(
  deps: RunRecorderDeps,
  ctx: { issueId: number; runId: string | null },
  outcome: VerifyStepOutcome,
): VerifyApplyResult {
  if (!applyInput(deps, ctx, outcome.input)) return { applied: false, feedback: null };
  const feedback =
    outcome.input.type === "VerifyFailed" && "feedback" in outcome ? outcome.feedback : null;
  return { applied: true, feedback };
}
