import { DEFAULT_PHASES } from "../src/index.ts";
import type { RunHeldReason, IssueState, WorkflowInput, WorkflowSnapshot } from "../src/index.ts";

export function snap(
  state: IssueState,
  overrides: Partial<WorkflowSnapshot> = {},
): WorkflowSnapshot {
  return {
    issueId: "i-1",
    state,
    heldReason: state === "Held" ? "PausedByHuman" : null,
    verifyRound: 0,
    qaRound: 0,
    reviewIter: 0,
    phases: DEFAULT_PHASES,
    phaseIndex: 0,
    ...overrides,
  };
}

export const SHA = "abc123";

export const INPUTS = {
  Admitted: { type: "Admitted" },
  NeedsTriage: { type: "NeedsTriage" },
  SpecialistAssigned: { type: "SpecialistAssigned" },
  TriageFailed: { type: "TriageFailed" },
  PhaseCompleted: { type: "PhaseCompleted" },
  WorkReported: { type: "WorkReported" },
  RunHeld: { type: "RunHeld", reason: "RuntimeFailed" },
  VerifyPassed: { type: "VerifyPassed" },
  VerifyFailed: { type: "VerifyFailed" },
  VerifyTimedOut: { type: "VerifyTimedOut" },
  VerifyHeadChanged: { type: "VerifyHeadChanged" },
  QaPassed: { type: "QaPassed" },
  QaFailed: { type: "QaFailed" },
  QaModifiedCode: { type: "QaModifiedCode" },
  ReviewApproved: { type: "ReviewApproved", headSha: SHA, prHeadSha: SHA },
  ChangesRequested: { type: "ChangesRequested" },
  ReviewRejected: { type: "ReviewRejected" },
  RiskAssessed: { type: "RiskAssessed", risk: "low", autoMerge: true },
  ApprovalGranted: {
    type: "ApprovalGranted",
    headSha: SHA,
    prHeadSha: SHA,
    decidedAt: 100,
    expiresAt: 200,
  },
  ApprovalDenied: { type: "ApprovalDenied" },
  ApprovalExpired: { type: "ApprovalExpired" },
  Merged: { type: "Merged" },
  MergeBlocked: { type: "MergeBlocked" },
  Resumed: { type: "Resumed" },
  CancelRequested: { type: "CancelRequested" },
} as const satisfies Record<WorkflowInput["type"], WorkflowInput>;

export const INPUT_TYPES = Object.keys(INPUTS) as WorkflowInput["type"][];

export const RUN_HELD_REASONS: readonly RunHeldReason[] = [
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
];

export const RUN_HELD_FROM: readonly IssueState[] = [
  "Triage",
  "InProgress",
  "Verify",
  "QA",
  "InReview",
];
