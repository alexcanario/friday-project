import { describe, expect, it } from "vitest";
import { transition, type WorkflowInput } from "../src/index.ts";
import { INPUTS, RUN_HELD_FROM, RUN_HELD_REASONS, SHA, snap } from "./fixtures.ts";

describe("guards", () => {
  it("binds the approval to the pr head sha", () => {
    const ok = transition(snap("InReview"), INPUTS.ReviewApproved);
    expect(ok.ok && ok.value.snapshot.state).toBe("RiskCheck");
    for (const other of ["def456", SHA.toUpperCase()]) {
      const s = snap("InReview");
      const r = transition(s, { type: "ReviewApproved", headSha: SHA, prHeadSha: other });
      expect(r).toEqual({ ok: false, error: "HeadShaMismatch" });
      expect(s.state).toBe("InReview");
    }
  });

  it("routes by risk and auto merge", () => {
    const cases = [
      ["low", true, "Merging"],
      ["low", false, "AwaitingApproval"],
      ["high", true, "AwaitingApproval"],
      ["unclassified", true, "AwaitingApproval"],
    ] as const;
    for (const [risk, autoMerge, to] of cases) {
      const r = transition(snap("RiskCheck"), { type: "RiskAssessed", risk, autoMerge });
      expect(r.ok && r.value.snapshot.state, `${risk} ${autoMerge}`).toBe(to);
    }
  });

  it("checks head and expiry on human approval", () => {
    const grant = (prHeadSha: string, decidedAt: number): WorkflowInput => ({
      type: "ApprovalGranted",
      headSha: SHA,
      prHeadSha,
      decidedAt,
      expiresAt: 200,
    });
    const cases = [
      [SHA, 199, "Merging", null],
      [SHA, 200, "Held", "ApprovalExpired"],
      [SHA, 201, "Held", "ApprovalExpired"],
      ["other", 199, "Held", "HeadChanged"],
      ["other", 200, "Held", "ApprovalExpired"],
    ] as const;
    for (const [pr, at, to, reason] of cases) {
      const r = transition(snap("AwaitingApproval"), grant(pr, at));
      if (!r.ok) throw new Error(r.error);
      expect(r.value.snapshot.state).toBe(to);
      expect(r.value.snapshot.heldReason).toBe(reason);
    }
  });

  it("accepts only run reasons on run held", () => {
    for (const from of RUN_HELD_FROM) {
      for (const reason of RUN_HELD_REASONS) {
        const r = transition(snap(from), { type: "RunHeld", reason });
        if (!r.ok) throw new Error(`${from} ${reason}`);
        expect(r.value.snapshot).toMatchObject({ state: "Held", heldReason: reason });
      }
      const bad = transition(snap(from), {
        type: "RunHeld",
        reason: "MergeBlocked",
      } as unknown as WorkflowInput);
      expect(bad).toEqual({ ok: false, error: "InvalidTransition" });
    }
  });
});
