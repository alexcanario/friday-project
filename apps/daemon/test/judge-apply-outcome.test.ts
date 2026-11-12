import { describe, expect, it } from "vitest";
import { apply, approved, changes, setup } from "./judge-dispatch-helpers.ts";

describe("applyJudgeOutcome", () => {
  it("moves InReview to RiskCheck when the review is approved", () => {
    const t = setup({ context: false });
    expect(apply(t, approved)).toEqual({ applied: true, feedback: null });
    expect(t.events.appended).toHaveLength(1);
    expect(t.events.appended[0]).toMatchObject({
      type: "StateChanged",
      runId: "r1",
      payload: { from: "InReview", to: "RiskCheck" },
    });
    expect(t.issues.rebuilds).toEqual([{ projectId: "p", appendedCount: 1 }]);
  });

  it("returns the feedback and holds after the third requested change", () => {
    const first = setup({ context: false });
    expect(apply(first, changes)).toEqual({ applied: true, feedback: "1. x" });
    expect(first.events.appended[0]?.payload).toMatchObject({ to: "InProgress", reviewIter: 1 });
    const third = setup({ reviewIter: 2, context: false });
    expect(apply(third, changes).applied).toBe(true);
    expect(third.events.appended[0]?.payload).toMatchObject({
      to: "Held",
      heldReason: "ReviewItersExhausted",
    });
  });

  it("holds the issue when the review is rejected or the run is held", () => {
    const rejected = setup({ context: false });
    apply(rejected, { kind: "rejected", input: { type: "ReviewRejected" }, reviewId: 501 });
    expect(rejected.events.appended[0]?.payload).toMatchObject({
      to: "Held",
      heldReason: "ReviewRejected",
    });
    const held = setup({ context: false });
    apply(held, { kind: "held", input: { type: "RunHeld", reason: "BudgetExceeded" } });
    expect(held.events.appended[0]?.payload).toMatchObject({
      to: "Held",
      heldReason: "BudgetExceeded",
    });
  });

  it("records nothing when the issue is not in review or the outcome has no input", () => {
    const heldIssue = setup({ state: "Held", context: false });
    expect(apply(heldIssue, approved)).toEqual({ applied: false, feedback: null });
    expect(heldIssue.events.appended).toEqual([]);
    expect(heldIssue.issues.rebuilds).toEqual([]);
    const t = setup({ context: false });
    expect(apply(t, { kind: "stale" })).toEqual({ applied: false, feedback: null });
    expect(apply(t, { kind: "invalid", violations: [] })).toEqual({
      applied: false,
      feedback: null,
    });
    expect(t.events.appended).toEqual([]);
  });
});
