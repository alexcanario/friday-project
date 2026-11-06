import { describe, expect, it } from "vitest";
import { transition } from "@friday/domain";
import { A, B, MemoryStale, inReview, setup, verdict } from "./judge-helpers.ts";

describe("judge gate", () => {
  it("approves when headSha equals the PR head", async () => {
    const s = setup(verdict());
    const out = await s.run();
    expect(out).toEqual({
      kind: "approved",
      reviewId: 501,
      input: { type: "ReviewApproved", headSha: A, prHeadSha: A },
    });
    if (out.kind !== "approved") throw new Error("kind");
    const next = transition(inReview(), out.input);
    expect(next.ok && next.value.snapshot.state).toBe("RiskCheck");
    expect(s.posted).toHaveLength(1);
    expect(s.stale.marked).toHaveLength(0);
    expect(s.runtime.requests).toHaveLength(1);
  });

  it("marks a mismatched verdict stale and never reuses it", async () => {
    const stale = new MemoryStale();
    const s = setup(verdict(), { head: B, stale });
    const out = await s.run();
    expect(out.kind).toBe("head_mismatch");
    if (out.kind !== "head_mismatch") throw new Error("kind");
    expect(transition(inReview(), out.input)).toEqual({ ok: false, error: "HeadShaMismatch" });
    expect(stale.marked).toEqual([["p", 7, A]]);
    expect(stale.isStale("p", 7, A)).toBe(true);
    expect(s.posted).toHaveLength(0);

    const again = setup(verdict(), { head: A, stale });
    expect((await again.run()).kind).toBe("stale");
    expect(again.posted).toHaveLength(0);

    const other = setup(verdict({ headSha: B }), { head: B, stale });
    expect((await other.run()).kind).toBe("approved");

    const changes = setup(verdict({ verdict: "changes_requested", findings: ["f"] }), {
      head: B,
    });
    expect((await changes.run()).kind).toBe("head_mismatch");
    expect(changes.stale.marked).toHaveLength(1);
    expect(changes.posted).toHaveLength(0);
  });

  it("returns findings up to 3 times then holds, and holds on reject", async () => {
    const changes = verdict({ verdict: "changes_requested", findings: ["f1", "f2"] });
    const out = await setup(changes).run();
    expect(out).toMatchObject({ kind: "changes_requested", feedback: "1. f1\n2. f2" });
    if (out.kind !== "changes_requested") throw new Error("kind");
    const first = transition(inReview(0), out.input);
    expect(first.ok && first.value.snapshot.state).toBe("InProgress");
    expect(first.ok && first.value.snapshot.reviewIter).toBe(1);
    const last = transition(inReview(2), out.input);
    expect(last.ok && last.value.snapshot.state).toBe("Held");
    expect(last.ok && last.value.snapshot.heldReason).toBe("ReviewItersExhausted");

    const rej = await setup(verdict({ verdict: "reject", findings: ["motivo"] })).run();
    expect(rej.kind).toBe("rejected");
    if (rej.kind !== "rejected") throw new Error("kind");
    const held = transition(inReview(), rej.input);
    expect(held.ok && held.value.snapshot.state).toBe("Held");
    expect(held.ok && held.value.snapshot.heldReason).toBe("ReviewRejected");
  });

  it("rejects invalid verdicts without changing state", async () => {
    const bad = verdict();
    const cases: Array<[unknown, string]> = [
      [
        verdict({ rules: [{ rule: 1, answer: "no", evidence: "x" }, ...(bad as any).rules.slice(1)] }),
        "approve_with_failed_rule",
      ],
      [verdict({ verdict: "changes_requested", findings: [] }), "findings_missing"],
      [verdict({ rules: (bad as any).rules.slice(1) }), "invalid_rules"],
      [verdict({ headSha: "a".repeat(39) }), "invalid_head_sha"],
    ];
    for (const [output, code] of cases) {
      const s = setup(output);
      const out = await s.run();
      expect(out.kind).toBe("invalid");
      if (out.kind !== "invalid") throw new Error("kind");
      expect(out.violations.map((v) => v.code)).toContain(code);
      expect(s.reads).toHaveLength(0);
      expect(s.stale.marked).toHaveLength(0);
      expect(s.posted).toHaveLength(0);
    }
    expect(await setup(verdict(), { status: "budget_exceeded" }).run()).toEqual({
      kind: "held",
      input: { type: "RunHeld", reason: "BudgetExceeded" },
    });
    expect(await setup(verdict(), { status: "failed" }).run()).toEqual({
      kind: "held",
      input: { type: "RunHeld", reason: "RuntimeFailed" },
    });
  });
});
