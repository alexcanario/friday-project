import { describe, expect, it } from "vitest";
import { chooseJudgeRole, parseDeclaredRisk } from "../src/index.ts";
import { makeAgents, setup, verdict } from "./judge-helpers.ts";

describe("judge run", () => {
  it("picks judge for low risk and judge-strong otherwise, both without Edit, Write or Bash", async () => {
    expect(parseDeclaredRisk("## Risco e gates\n- risco: low — texto")).toBe("low");
    expect(parseDeclaredRisk("sem linha")).toBeNull();
    expect(parseDeclaredRisk("- risco: banana")).toBeNull();
    expect(chooseJudgeRole({ declaredRisk: "low", labels: ["friday"] })).toBe("judge");
    expect(chooseJudgeRole({ declaredRisk: "low", labels: ["gate:security"] })).toBe(
      "judge-strong",
    );
    expect(chooseJudgeRole({ declaredRisk: null, labels: [] })).toBe("judge-strong");
    const cases: Array<[string, string[], string]> = [
      ["- risco: low — x", ["friday"], "sonnet"],
      ["- risco: medium — x", ["friday"], "opus"],
      ["- risco: high — x", ["friday"], "opus"],
      ["sem linha", ["friday"], "opus"],
      ["- risco: banana", ["friday"], "opus"],
      ["- risco: low — x", ["friday", "gate:security"], "opus"],
    ];
    for (const [body, labels, model] of cases) {
      const s = setup(verdict(), { body, labels });
      await s.run();
      const agent = s.runtime.requests[0]?.agent;
      expect(agent?.model).toBe(model);
      for (const t of ["Edit", "Write", "Bash"]) expect(agent?.tools).not.toContain(t);
    }
  });

  it("refuses a judge definition outside the allow-list before AgentRuntime.run", async () => {
    const bad = [
      { tools: ["Read", "Bash"] },
      { tools: ["Edit"] },
      { allowedTools: ["mcp__friday__issue_comment"] },
    ];
    for (const over of bad) {
      const s = setup(verdict(), { agents: makeAgents(over as never) });
      expect(await s.run()).toEqual({
        kind: "held",
        input: { type: "RunHeld", reason: "RunMisconfigured" },
      });
      expect(s.runtime.requests).toHaveLength(0);
    }
    const ok = setup(verdict());
    await ok.run();
    expect(ok.runtime.requests).toHaveLength(1);
  });

  const heldMisconfigured = {
    kind: "held",
    input: { type: "RunHeld", reason: "RunMisconfigured" },
  };

  it("refuses a judge whose states are not exactly InReview before AgentRuntime.run", async () => {
    const s = setup(verdict(), { agents: makeAgents({ states: ["QA"] }) });
    expect(await s.run()).toEqual(heldMisconfigured);
    expect(s.runtime.requests).toHaveLength(0);
  });

  it("refuses states [], two states, and a judge-strong with QA after a medium-risk judge verdict", async () => {
    for (const states of [[], ["InReview", "QA"]]) {
      const s = setup(verdict(), { agents: makeAgents({ states } as never) });
      expect(await s.run()).toEqual(heldMisconfigured);
      expect(s.runtime.requests).toHaveLength(0);
    }
    const agents = makeAgents();
    const strongQa = { ...agents, "judge-strong": { ...agents["judge-strong"], states: ["QA"] } };
    const s = setup(verdict({ risk: "medium" }), { agents: strongQa as never });
    expect(await s.run()).toEqual(heldMisconfigured);
    expect(s.runtime.requests).toHaveLength(1);
    expect(s.posted).toHaveLength(0);
  });
});
