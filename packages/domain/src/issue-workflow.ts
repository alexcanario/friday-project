import type { HeldReason } from "./held-reason.ts";
import { RUN_HELD_REASONS } from "./held-reason.ts";
import { err, ok, type Result } from "./result.ts";
import { isAllowed } from "./transitions.ts";
import {
  DEFAULT_PHASES,
  type Phase,
  type StateChanged,
  type WorkflowInput,
  type WorkflowSnapshot,
} from "./types.ts";

export type TransitionError = "InvalidTransition" | "HeadShaMismatch";
export type TransitionOutcome = { snapshot: WorkflowSnapshot; event: StateChanged | null };

const MAX_ROUNDS = 3;

export function createWorkflow(
  issueId: string,
  phases: readonly Phase[] = DEFAULT_PHASES,
): Result<WorkflowSnapshot, "InvalidPhases"> {
  if (phases.length === 0) return err("InvalidPhases");
  return ok({
    issueId,
    state: "Backlog",
    heldReason: null,
    verifyRound: 0,
    qaRound: 0,
    reviewIter: 0,
    phases,
    phaseIndex: 0,
  });
}

export function currentPhase(snapshot: WorkflowSnapshot): Phase | null {
  return snapshot.phases[snapshot.phaseIndex] ?? null;
}

type Next = Partial<WorkflowSnapshot> & Pick<WorkflowSnapshot, "state">;

const hold = (heldReason: HeldReason, extra: Partial<WorkflowSnapshot> = {}): Next => ({
  ...extra,
  state: "Held",
  heldReason,
});

function retry(
  s: WorkflowSnapshot,
  counter: "verifyRound" | "qaRound" | "reviewIter",
  reason: HeldReason,
): Next {
  const value = s[counter] + 1;
  if (value >= MAX_ROUNDS) return hold(reason, { [counter]: value });
  return { state: "InProgress", phaseIndex: 0, [counter]: value };
}

function resume(s: WorkflowSnapshot): Next {
  const reset: Partial<WorkflowSnapshot> =
    s.heldReason === "VerifyRoundsExhausted"
      ? { verifyRound: 0 }
      : s.heldReason === "QaRoundsExhausted"
        ? { qaRound: 0 }
        : s.heldReason === "ReviewItersExhausted"
          ? { reviewIter: 0 }
          : {};
  return { ...reset, state: "InProgress", phaseIndex: 0 };
}

function approval(input: Extract<WorkflowInput, { type: "ApprovalGranted" }>): Next {
  if (!(input.decidedAt < input.expiresAt)) return hold("ApprovalExpired");
  if (input.headSha !== input.prHeadSha) return hold("HeadChanged");
  return { state: "Merging" };
}

function decideProgress(s: WorkflowSnapshot, input: WorkflowInput): Result<Next, TransitionError> {
  switch (input.type) {
    case "Admitted":
      return ok({ state: "Todo" });
    case "NeedsTriage":
      return ok({ state: "Triage" });
    case "SpecialistAssigned":
      return ok({ state: "InProgress" });
    case "TriageFailed":
      return ok(hold("TriageFailed"));
    case "PhaseCompleted":
      if (currentPhase(s) === null) return err("InvalidTransition");
      return ok({ state: "InProgress", phaseIndex: s.phaseIndex + 1 });
    case "WorkReported":
      if (currentPhase(s) !== null) return err("InvalidTransition");
      return ok({ state: "Verify" });
    case "RunHeld":
      if (!RUN_HELD_REASONS.includes(input.reason)) return err("InvalidTransition");
      return ok(hold(input.reason));
    default:
      return decideChecks(s, input);
  }
}

function decideChecks(s: WorkflowSnapshot, input: WorkflowInput): Result<Next, TransitionError> {
  switch (input.type) {
    case "VerifyPassed":
      return ok({ state: "QA" });
    case "VerifyFailed":
      return ok(retry(s, "verifyRound", "VerifyRoundsExhausted"));
    case "VerifyTimedOut":
      return ok(hold("VerifyTimeout"));
    case "VerifyHeadChanged":
      return ok(hold("HeadChanged"));
    case "QaPassed":
      return ok({ state: "InReview" });
    case "QaFailed":
      return ok(retry(s, "qaRound", "QaRoundsExhausted"));
    case "QaModifiedCode":
      return ok(hold("QaModifiedCode"));
    case "ReviewApproved":
      if (input.headSha !== input.prHeadSha) return err("HeadShaMismatch");
      return ok({ state: "RiskCheck" });
    case "ChangesRequested":
      return ok(retry(s, "reviewIter", "ReviewItersExhausted"));
    case "ReviewRejected":
      return ok(hold("ReviewRejected"));
    default:
      return decideRelease(s, input);
  }
}

function decideRelease(s: WorkflowSnapshot, input: WorkflowInput): Result<Next, TransitionError> {
  switch (input.type) {
    case "RiskAssessed":
      return ok({
        state: input.risk === "low" && input.autoMerge ? "Merging" : "AwaitingApproval",
      });
    case "ApprovalGranted":
      return ok(approval(input));
    case "ApprovalDenied":
      return ok(hold("ApprovalDenied"));
    case "ApprovalExpired":
      return ok(hold("ApprovalExpired"));
    case "Merged":
      return ok({ state: "Done" });
    case "MergeBlocked":
      return ok(hold("MergeBlocked"));
    case "Resumed":
      return ok(resume(s));
    case "CancelRequested":
      return ok({ state: "Canceled" });
    default:
      return err("InvalidTransition");
  }
}

export function transition(
  snapshot: WorkflowSnapshot,
  input: WorkflowInput,
): Result<TransitionOutcome, TransitionError> {
  if (!isAllowed(snapshot.state, input.type)) return err("InvalidTransition");
  const decided = decideProgress(snapshot, input);
  if (!decided.ok) return decided;
  const next: WorkflowSnapshot = {
    ...snapshot,
    heldReason: null,
    ...decided.value,
  };
  const event: StateChanged | null =
    input.type === "PhaseCompleted"
      ? null
      : {
          type: "StateChanged",
          issueId: snapshot.issueId,
          from: snapshot.state,
          to: next.state,
          trigger: input.type,
          heldReason: next.heldReason,
        };
  return ok({ snapshot: next, event });
}
