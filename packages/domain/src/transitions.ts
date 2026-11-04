import type { IssueState, WorkflowInput } from "./types.ts";

type InputType = WorkflowInput["type"];

export const TRANSITIONS = [
  { from: "Backlog", on: "Admitted" },
  { from: "Todo", on: "NeedsTriage" },
  { from: "Todo", on: "SpecialistAssigned" },
  { from: "Triage", on: "SpecialistAssigned" },
  { from: "Triage", on: "TriageFailed" },
  { from: "InProgress", on: "PhaseCompleted" },
  { from: "InProgress", on: "WorkReported" },
  { from: "Triage", on: "RunHeld" },
  { from: "InProgress", on: "RunHeld" },
  { from: "Verify", on: "RunHeld" },
  { from: "QA", on: "RunHeld" },
  { from: "InReview", on: "RunHeld" },
  { from: "Verify", on: "VerifyPassed" },
  { from: "Verify", on: "VerifyFailed" },
  { from: "Verify", on: "VerifyTimedOut" },
  { from: "QA", on: "QaPassed" },
  { from: "QA", on: "QaFailed" },
  { from: "QA", on: "QaModifiedCode" },
  { from: "InReview", on: "ReviewApproved" },
  { from: "InReview", on: "ChangesRequested" },
  { from: "InReview", on: "ReviewRejected" },
  { from: "RiskCheck", on: "RiskAssessed" },
  { from: "AwaitingApproval", on: "ApprovalGranted" },
  { from: "AwaitingApproval", on: "ApprovalDenied" },
  { from: "AwaitingApproval", on: "ApprovalExpired" },
  { from: "Merging", on: "Merged" },
  { from: "Merging", on: "MergeBlocked" },
  { from: "Held", on: "Resumed" },
  { from: "Held", on: "CancelRequested" },
] as const satisfies readonly { from: IssueState; on: InputType }[];

export function isAllowed(from: IssueState, on: InputType): boolean {
  return TRANSITIONS.some((t) => t.from === from && t.on === on);
}
