import type { HeldReason, RunHeldReason } from "./held-reason.ts";

export const ISSUE_STATES = [
  "Backlog",
  "Todo",
  "Triage",
  "InProgress",
  "Verify",
  "QA",
  "InReview",
  "RiskCheck",
  "AwaitingApproval",
  "Merging",
  "Done",
  "Held",
  "Canceled",
] as const;

export type IssueState = (typeof ISSUE_STATES)[number];

export interface Phase {
  role: string;
  inputs: readonly string[];
  outputs: readonly string[];
  deterministic: boolean;
}

export const DEFAULT_PHASES: readonly Phase[] = [
  { role: "implement", inputs: [], outputs: [], deterministic: false },
];

export interface WorkflowSnapshot {
  issueId: string;
  state: IssueState;
  heldReason: HeldReason | null;
  verifyRound: number;
  qaRound: number;
  reviewIter: number;
  phases: readonly Phase[];
  phaseIndex: number;
}

export type Risk = "low" | "high" | "unclassified";

export type WorkflowInput =
  | { type: "Admitted" }
  | { type: "NeedsTriage" }
  | { type: "SpecialistAssigned" }
  | { type: "TriageFailed" }
  | { type: "PhaseCompleted" }
  | { type: "WorkReported" }
  | { type: "RunHeld"; reason: RunHeldReason }
  | { type: "VerifyPassed" }
  | { type: "VerifyFailed" }
  | { type: "VerifyTimedOut" }
  | { type: "QaPassed" }
  | { type: "QaFailed" }
  | { type: "QaModifiedCode" }
  | { type: "ReviewApproved"; headSha: string; prHeadSha: string }
  | { type: "ChangesRequested" }
  | { type: "ReviewRejected" }
  | { type: "RiskAssessed"; risk: Risk; autoMerge: boolean }
  | {
      type: "ApprovalGranted";
      headSha: string;
      prHeadSha: string;
      decidedAt: number;
      expiresAt: number;
    }
  | { type: "ApprovalDenied" }
  | { type: "ApprovalExpired" }
  | { type: "Merged" }
  | { type: "MergeBlocked" }
  | { type: "Resumed" }
  | { type: "CancelRequested" };

export interface StateChanged {
  type: "StateChanged";
  issueId: string;
  from: IssueState;
  to: IssueState;
  trigger: WorkflowInput["type"];
  heldReason: HeldReason | null;
}
