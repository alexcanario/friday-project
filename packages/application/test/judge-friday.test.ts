import { describe, expect, it } from "vitest";
import { FakeAgentRuntime, runJudgeStep } from "../src/index.ts";
import { makeAgents, setup, verdict } from "./judge-helpers.ts";
import { finished } from "./qa-step-helpers.ts";

describe("judge friday MCP server", () => {
  it("sends friday with the run id, states and mcp tools to the judge run", async () => {
    const s = setup(verdict({ risk: "low" }));
    await s.run();
    expect(s.runtime.requests).toHaveLength(1);
    const friday = s.runtime.requests[0]?.friday;
    expect(friday?.runId).toBe(s.input.friday.runId);
    expect(friday?.agent).toEqual({
      states: ["InReview"],
      mcp_tools: ["review_verdict", "pr_diff"],
    });
    expect(friday?.effects?.run).toBe(s.input.friday.effects.run);
    expect(friday?.getIssueState()).toBe("InReview");
  });

  it("the judge-strong repeat also sends friday with the same run id", async () => {
    const s = setup(verdict({ risk: "medium" }));
    const runtime = new FakeAgentRuntime([
      finished(verdict({ risk: "medium" })),
      finished(verdict({ risk: "medium" })),
    ]);
    await runJudgeStep({ ...s.deps, runtime }, s.input);
    expect(runtime.requests).toHaveLength(2);
    expect(runtime.requests.map((r) => r.agent.model)).toEqual(["sonnet", "opus"]);
    for (const request of runtime.requests) {
      expect(request.friday?.runId).toBe(s.input.friday.runId);
    }
    expect(runtime.requests[0]?.friday?.agent.mcp_tools).toEqual(["review_verdict", "pr_diff"]);
    // The repeat cannot post a second verdict (409): only pr_diff stays.
    expect(runtime.requests[1]?.friday?.agent.mcp_tools).toEqual(["pr_diff"]);
  });

  it("a role outside the allow-list is held and never runs", async () => {
    const s = setup(verdict(), { agents: makeAgents({ tools: ["Bash"] }) });
    const out = await s.run();
    expect(out).toEqual({ kind: "held", input: { type: "RunHeld", reason: "RunMisconfigured" } });
    expect(s.runtime.requests).toHaveLength(0);
  });
});
