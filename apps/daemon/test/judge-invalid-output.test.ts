import { describe, expect, it } from "vitest";
import { runJudgeForIssue } from "../src/judge-dispatch.ts";
import { A, B, finished, setup, verdict } from "./judge-dispatch-helpers.ts";

const invalid = () => finished(null, "invalid_output");

describe("judge invalid_output", () => {
  it("keeps the issue in InReview on invalid_output", async () => {
    const t = setup({ results: [invalid()] });
    await runJudgeForIssue(t.deps, 7);
    expect(t.issues.row?.state).toBe("InReview");
    expect(t.issues.row?.heldReason).toBeNull();
    expect(t.ofType("StateChanged")).toEqual([]);
    expect(t.events.appended.some((e) => JSON.stringify(e.payload).includes("RunHeld"))).toBe(
      false,
    );
  });

  it("records RunFinished then JudgeSkipped invalid on invalid_output", async () => {
    const t = setup({ results: [invalid()] });
    await expect(runJudgeForIssue(t.deps, 7)).resolves.toEqual({ applied: false, feedback: null });
    expect(t.types()).toEqual(["RunFinished", "JudgeSkipped"]);
    expect(t.ofType("RunFinished")[0]?.payload).toMatchObject({ status: "invalid_output" });
    expect(t.ofType("JudgeSkipped")[0]?.payload).toEqual({ reason: "invalid", headSha: A });
    expect(t.posted).toEqual([]);
  });

  it("runs the judge again only when the head changes", async () => {
    const t = setup({
      heads: [A, A, B],
      results: [invalid(), finished(verdict({ headSha: B }))],
    });
    await runJudgeForIssue(t.deps, 7);
    await runJudgeForIssue(t.deps, 7);
    expect(t.runtime.requests).toHaveLength(1);
    await expect(runJudgeForIssue(t.deps, 7)).resolves.toEqual({ applied: true, feedback: null });
    expect(t.runtime.requests).toHaveLength(2);
    expect(t.ofType("StateChanged")[0]?.payload).toMatchObject({ to: "RiskCheck" });
  });

  it("still holds on budget_exceeded and still applies an approval", async () => {
    const held = setup({ results: [finished(null, "budget_exceeded")] });
    await runJudgeForIssue(held.deps, 7);
    expect(held.issues.row?.state).toBe("Held");
    expect(held.issues.row?.heldReason).toBe("BudgetExceeded");
    const ok = setup();
    await runJudgeForIssue(ok.deps, 7);
    expect(ok.ofType("StateChanged")[0]?.payload).toMatchObject({ to: "RiskCheck" });
  });
});
