import { describe, expect, it, vi } from "vitest";
import { FakeAgentRuntime, renderReviewBody, runJudgeStep } from "../src/index.ts";
import { A, B, MemoryStale, makeAgents, setup, verdict } from "./judge-helpers.ts";
import { finished } from "./qa-step-helpers.ts";

function twoRuns(first: unknown, second: unknown, opts: Parameters<typeof setup>[1] = {}) {
  const s = setup(first, opts);
  const runtime = new FakeAgentRuntime([finished(first), finished(second)]);
  const deps = { ...s.deps, runtime };
  return { ...s, runtime, deps };
}

const FRIDAY = "mcp__friday__";

/** The tool names the request offers in both places the runtime compares. */
function toolsOf(r: { agent: { allowedTools: string[] }; friday?: { agent: { mcp_tools: string[] } } } | undefined) {
  const allowed = (r?.agent.allowedTools ?? [])
    .filter((t) => t.startsWith(FRIDAY))
    .map((t) => t.slice(FRIDAY.length))
    .sort();
  return { allowed, mcp: [...(r?.friday?.agent.mcp_tools ?? [])].sort() };
}

describe("judge repeat (D39)", () => {
  it("does not repeat when the judge reports low risk", async () => {
    const s = setup(verdict({ risk: "low" }));
    const out = await s.run();
    expect(s.runtime.requests).toHaveLength(1);
    expect(s.posted).toHaveLength(1);
    expect(out.kind).toBe("approved");
    expect(toolsOf(s.runtime.requests[0])).toEqual({
      allowed: ["pr_diff", "review_verdict"],
      mcp: ["pr_diff", "review_verdict"],
    });
  });

  it("repeats once with judge-strong when the judge reports higher risk", async () => {
    for (const first of ["medium", "high"]) {
      const s = twoRuns(verdict({ risk: first }), verdict({ risk: "high" }));
      const out = await runJudgeStep(s.deps, s.input);
      const [r0, r1] = s.runtime.requests;
      expect(s.runtime.requests).toHaveLength(2);
      expect(r0?.agent.model).toBe("sonnet");
      expect(r1?.agent.model).toBe("opus");
      expect(toolsOf(r0)).toEqual({
        allowed: ["pr_diff", "review_verdict"],
        mcp: ["pr_diff", "review_verdict"],
      });
      // The repeat cannot send a second review_verdict (409): both lists drop it together.
      expect(toolsOf(r1)).toEqual({ allowed: ["pr_diff"], mcp: ["pr_diff"] });
      expect([r1?.cwd, r1?.prompt, r1?.configRoot]).toEqual([r0?.cwd, r0?.prompt, r0?.configRoot]);
      expect(out.kind).toBe("approved");
      expect(s.posted).toHaveLength(1);
    }
  });

  it("uses the verdict of the repeated run and discards the first", async () => {
    const stale = new MemoryStale();
    const isStale = vi.spyOn(stale, "isStale");
    const markStale = vi.spyOn(stale, "markStale");
    const second = verdict({
      verdict: "changes_requested",
      findings: ["f1"],
      risk: "medium",
    });
    const s = twoRuns(verdict({ risk: "medium", headSha: B }), second, {
      stale,
      expectedHeadSha: A,
    });
    const out = await runJudgeStep(s.deps, s.input);
    expect(out).toMatchObject({ kind: "changes_requested", feedback: "1. f1" });
    expect(s.posted[0]?.[1].event).toBe("REQUEST_CHANGES");
    expect(s.posted[0]?.[1].body).toBe(renderReviewBody(second as never));
    expect(markStale).not.toHaveBeenCalled();
    expect(isStale).toHaveBeenCalledTimes(1);
    expect(isStale).toHaveBeenCalledWith("p", 7, A);
  });

  it("never repeats for judge-strong", async () => {
    const cases = [
      { body: "- risco: medium — x" },
      { body: "sem linha de risco" },
      { labels: ["friday", "gate:security"] },
    ];
    for (const c of cases) {
      for (const risk of ["low", "high"]) {
        const s = setup(verdict({ risk }), c);
        await s.run();
        expect(s.runtime.requests).toHaveLength(1);
        expect(s.runtime.requests[0]?.agent.model).toBe("opus");
        expect(toolsOf(s.runtime.requests[0])).toEqual({
          allowed: ["pr_diff", "review_verdict"],
          mcp: ["pr_diff", "review_verdict"],
        });
      }
    }
    const s = setup(verdict({ risk: "low" }), { body: "- risco: medium — x" });
    expect((await s.run()).kind).toBe("approved");
  });

  it("holds or rejects when the repeated run fails, and does not repeat an invalid verdict", async () => {
    const budget = twoRuns(verdict({ risk: "high" }), null);
    budget.deps.runtime = new FakeAgentRuntime([
      finished(verdict({ risk: "high" })),
      finished(null, "budget_exceeded"),
    ]);
    expect(await runJudgeStep(budget.deps, budget.input)).toEqual({
      kind: "held",
      input: { type: "RunHeld", reason: "BudgetExceeded" },
    });
    expect(budget.posted).toHaveLength(0);

    const { risk: _r, ...noRisk } = verdict() as Record<string, unknown>;
    void _r;
    const bad = twoRuns(verdict({ risk: "high" }), noRisk);
    const out = await runJudgeStep(bad.deps, bad.input);
    expect(out.kind).toBe("invalid");
    expect(out.kind === "invalid" && out.violations).toContainEqual(
      expect.objectContaining({ code: "required_field", path: "risk" }),
    );

    const agents = makeAgents();
    agents["judge-strong"] = { ...agents["judge-strong"], tools: ["Bash"] } as never;
    const mis = twoRuns(verdict({ risk: "medium" }), verdict(), { agents });
    expect(await runJudgeStep(mis.deps, mis.input)).toEqual({
      kind: "held",
      input: { type: "RunHeld", reason: "RunMisconfigured" },
    });
    expect(mis.runtime.requests).toHaveLength(1);

    const first = twoRuns(noRisk, verdict());
    expect((await runJudgeStep(first.deps, first.input)).kind).toBe("invalid");
    expect(first.runtime.requests).toHaveLength(1);
  });
});
