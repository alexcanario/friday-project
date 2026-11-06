import { describe, expect, it } from "vitest";
import { runJudgeForIssue } from "../src/judge-dispatch.ts";
import { agents, finished, logged, setup, verdict } from "./judge-dispatch-helpers.ts";

describe("runJudgeForIssue run registration", () => {
  it("records the run row and RunFinished for the judge", async () => {
    const t = setup();
    await runJudgeForIssue(t.deps, 7);
    expect(t.runs.rows.get("r1")).toMatchObject({
      id: "r1",
      status: "succeeded",
      finishedAt: expect.anything(),
    });
    expect(t.runs.rows.size).toBe(1);
    expect(t.ofType("RunFinished")).toHaveLength(1);
    expect(t.ofType("RunFinished")[0]?.runId).toBe("r1");
    expect(t.ofType("StateChanged")[0]?.runId).toBe("r1");
    const medium = setup({
      results: [finished(verdict({ risk: "medium" })), finished(verdict({ risk: "medium" }))],
    });
    await runJudgeForIssue(medium.deps, 7);
    expect(medium.ofType("RunFinished")).toHaveLength(2);
  });

  it("holds as misconfigured when judge-strong has tools outside the allow list", async () => {
    const bad = setup({ agents: agents({ tools: ["Bash"] }) });
    await runJudgeForIssue(bad.deps, 7);
    expect(bad.runtime.requests).toHaveLength(0);
    expect(bad.ofType("RunFinished")).toEqual([]);
    expect(bad.ofType("StateChanged")[0]?.payload).toMatchObject({
      to: "Held",
      heldReason: "RunMisconfigured",
    });
    const strong = setup({
      results: [finished(verdict({ risk: "medium" }))],
      agents: agents({}, { tools: ["Bash"] }),
    });
    await runJudgeForIssue(strong.deps, 7);
    expect(strong.ofType("RunFinished")).toHaveLength(1);
    expect(strong.ofType("StateChanged")).toHaveLength(1);
    expect(strong.ofType("StateChanged")[0]?.payload).toMatchObject({
      to: "Held",
      heldReason: "RunMisconfigured",
    });
  });

  it("closes the run as failed when the step throws or the run is held", async () => {
    const boom = setup({ postFail: new Error("boom") });
    await expect(runJudgeForIssue(boom.deps, 7)).resolves.toEqual({
      applied: false,
      feedback: null,
    });
    expect(boom.runs.rows.get("r1")).toMatchObject({
      status: "failed",
      finishedAt: expect.anything(),
    });
    expect(logged(boom)).toContain("boom");
    const budget = setup({ results: [finished(null, "budget_exceeded")] });
    await runJudgeForIssue(budget.deps, 7);
    expect(budget.runs.rows.get("r1")?.status).toBe("failed");
    expect(budget.ofType("StateChanged")).toHaveLength(1);
    expect(budget.ofType("StateChanged")[0]?.payload).toMatchObject({
      to: "Held",
      heldReason: "BudgetExceeded",
    });
  });
});
