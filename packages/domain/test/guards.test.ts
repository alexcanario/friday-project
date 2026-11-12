import { describe, expect, it } from "vitest";
import {
  HELD_REASONS,
  RUN_HELD_REASONS as RUN_HELD_REASONS_SRC,
  transition,
  type WorkflowInput,
} from "../src/index.ts";
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

  it("treats an invalid approval time as expired", () => {
    const grant = (decidedAt: number, expiresAt: number): WorkflowInput => ({
      type: "ApprovalGranted",
      headSha: SHA,
      prHeadSha: SHA,
      decidedAt,
      expiresAt,
    });
    const bad: [number, number][] = [
      [Number.NaN, 200],
      [100, Number.NaN],
    ];
    for (const [at, exp] of bad) {
      const r = transition(snap("AwaitingApproval"), grant(at, exp));
      if (!r.ok) throw new Error(r.error);
      expect(r.value.snapshot).toMatchObject({ state: "Held", heldReason: "ApprovalExpired" });
    }
    const good = transition(snap("AwaitingApproval"), grant(100, 200));
    expect(good.ok && good.value.snapshot.state).toBe("Merging");
  });

  it("rejects the reasons outside the run list", () => {
    const outside = [
      "TriageFailed",
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
    ];
    expect(outside).toHaveLength(13);
    for (const from of RUN_HELD_FROM) {
      for (const reason of [...outside, "Nope"]) {
        const r = transition(snap(from), { type: "RunHeld", reason } as unknown as WorkflowInput);
        expect(r, `${from} ${reason}`).toEqual({ ok: false, error: "InvalidTransition" });
      }
    }
  });

  it("RunHeld accepts SpecialistWithoutAgent from Triage and InProgress and rejects an unknown reason", () => {
    for (const from of ["Triage", "InProgress"] as const) {
      const r = transition(snap(from), { type: "RunHeld", reason: "SpecialistWithoutAgent" });
      expect(r.ok && r.value.snapshot).toMatchObject({
        state: "Held",
        heldReason: "SpecialistWithoutAgent",
      });
    }
    const bad = transition(snap("Triage"), {
      type: "RunHeld",
      reason: "Nope",
    } as unknown as WorkflowInput);
    expect(bad).toEqual({ ok: false, error: "InvalidTransition" });
  });

  it("RunHeld accepts JudgeContextMissing from every run state and rejects it elsewhere", () => {
    expect(HELD_REASONS.filter((r) => r === "JudgeContextMissing")).toHaveLength(1);
    expect(RUN_HELD_REASONS_SRC.filter((r) => r === "JudgeContextMissing")).toHaveLength(1);
    const input = { type: "RunHeld", reason: "JudgeContextMissing" } as const;
    for (const from of RUN_HELD_FROM) {
      const entry = snap(from, { verifyRound: 1, qaRound: 2, reviewIter: 3 });
      const r = transition(entry, input);
      if (!r.ok) throw new Error(`${from}`);
      expect(r.value.snapshot).toMatchObject({
        state: "Held",
        heldReason: "JudgeContextMissing",
        verifyRound: 1,
        qaRound: 2,
        reviewIter: 3,
      });
      expect(r.value.event).toMatchObject({
        trigger: "RunHeld",
        to: "Held",
        heldReason: "JudgeContextMissing",
      });
    }
    for (const from of ["RiskCheck", "Held", "Done"] as const) {
      expect(transition(snap(from), input), from).toEqual({ ok: false, error: "InvalidTransition" });
    }
  });
});
