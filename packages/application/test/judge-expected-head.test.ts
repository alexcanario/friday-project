import { describe, expect, it } from "vitest";
import { transition } from "@friday/domain";
import { A, B, MemoryStale, inReview, setup, verdict } from "./judge-helpers.ts";

describe("judge expected head", () => {
  it("refuses a verdict for a head other than the one the run started with, without marking it stale", async () => {
    const s = setup(verdict({ headSha: B }), { expectedHeadSha: A, head: B });
    const out = await s.run();
    expect(out).toEqual({
      kind: "head_mismatch",
      input: { type: "ReviewApproved", headSha: B, prHeadSha: A },
      skipHeadSha: A,
    });
    if (out.kind !== "head_mismatch") throw new Error("kind");
    expect(s.posted).toHaveLength(0);
    expect(s.reads).toHaveLength(0);
    expect(s.stale.marked).toEqual([]);
    expect(transition(inReview(), out.input)).toEqual({ ok: false, error: "HeadShaMismatch" });
  });

  it("posts the review when the verdict head equals the expected head", async () => {
    const s = setup(verdict({ headSha: A }), { expectedHeadSha: A, head: A });
    const out = await s.run();
    expect(out.kind).toBe("approved");
    if (out.kind !== "approved") throw new Error("kind");
    expect(s.posted).toHaveLength(1);
    expect(s.posted[0]?.[1].commitId).toBe(A);
    const next = transition(inReview(), out.input);
    expect(next.ok && next.value.snapshot.state).toBe("RiskCheck");
  });

  it("refuses changes_requested and reject verdicts for another head", async () => {
    const cases = [
      verdict({ verdict: "changes_requested", findings: ["f1"], headSha: B }),
      verdict({ verdict: "reject", findings: ["motivo"], headSha: B }),
    ];
    for (const output of cases) {
      const s = setup(output, { expectedHeadSha: A, head: B });
      const out = await s.run();
      expect(out.kind).toBe("head_mismatch");
      expect(out).toMatchObject({ skipHeadSha: A });
      expect(s.posted).toHaveLength(0);
      expect(s.stale.marked).toEqual([]);
    }
  });

  it("checks stale first and keeps the readPrHead check after the expected head check", async () => {
    const stale = new MemoryStale();
    stale.markStale("p", 7, B);
    const first = setup(verdict({ headSha: B }), { expectedHeadSha: A, head: B, stale });
    expect((await first.run()).kind).toBe("stale");
    expect(first.posted).toHaveLength(0);

    const moved = setup(verdict({ headSha: A }), { expectedHeadSha: A, head: B });
    const out = await moved.run();
    expect(out.kind).toBe("head_mismatch");
    expect(out).not.toHaveProperty("skipHeadSha");
    expect(moved.stale.marked).toEqual([["p", 7, A]]);
    expect(moved.posted).toHaveLength(0);
  });
});
