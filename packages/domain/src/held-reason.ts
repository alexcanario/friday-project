export const HELD_REASONS = [
  "TriageFailed",
  "RunMisconfigured",
  "BudgetExceeded",
  "TurnsExceeded",
  "RuntimeFailed",
  "BreakerOpen",
  "BudgetExhausted",
  "IssueBudgetExceeded",
  "SchemaInvalid",
  "VerifyRoundsExhausted",
  "VerifyTimeout",
  "QaRoundsExhausted",
  "QaModifiedCode",
  "ReviewItersExhausted",
  "ReviewRejected",
  "ApprovalDenied",
  "ApprovalExpired",
  "HeadChanged",
  "MergeBlocked",
  "ConfidenceBelowHigh",
  "IncidentOpen",
  "Reconciled",
  "PausedByHuman",
  "SpecialistWithoutAgent",
  "JudgeContextMissing",
] as const;

export type HeldReason = (typeof HELD_REASONS)[number];

/** Reasons a run may report through the RunHeld input (D32). */
export const RUN_HELD_REASONS = [
  "RunMisconfigured",
  "BudgetExceeded",
  "TurnsExceeded",
  "RuntimeFailed",
  "BreakerOpen",
  "BudgetExhausted",
  "IssueBudgetExceeded",
  "SchemaInvalid",
  "Reconciled",
  "PausedByHuman",
  "SpecialistWithoutAgent",
  "JudgeContextMissing",
] as const satisfies readonly HeldReason[];

export type RunHeldReason = (typeof RUN_HELD_REASONS)[number];
