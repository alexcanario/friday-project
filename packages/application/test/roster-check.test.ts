import type { AgentConfig } from "@friday/contracts";
import { describe, expect, it } from "vitest";
import { checkRoster } from "../src/index.ts";

function agent(role: string, states: AgentConfig["states"]): AgentConfig {
  return {
    role,
    states,
    model: "sonnet",
    max_budget_usd: 1.5,
    max_turns: 40,
    timeout_s: 3600,
    tools: ["Read"],
    mcp_tools: ["work_report"],
    prompt_file: `prompts/${role}.md`,
  };
}

const roster: AgentConfig[] = [
  agent("qa", ["QA"]),
  agent("judge", ["InReview"]),
  ...["backend", "database", "frontend", "infra", "security"].map((r) => agent(r, ["InProgress"])),
];

describe("checkRoster", () => {
  it("requires agents for states and specialists", () => {
    expect(checkRoster(roster)).toEqual([]);

    const states: Array<[string, string]> = [
      ["qa", "QA"],
      ["judge", "InReview"],
    ];
    for (const [role, state] of states) {
      const problems = checkRoster(roster.filter((a) => a.role !== role));
      expect(problems).toEqual([
        {
          file: "agents",
          line: 1,
          code: "state_without_agent",
          message: `Estado sem agente: ${state}.`,
        },
      ]);
    }

    const noImplementers = checkRoster(roster.filter((a) => !a.states.includes("InProgress")));
    expect(noImplementers.filter((p) => p.code === "state_without_agent")).toEqual([
      {
        file: "agents",
        line: 1,
        code: "state_without_agent",
        message: "Estado sem agente: InProgress.",
      },
    ]);
    expect(noImplementers.filter((p) => p.code === "specialist_without_agent")).toHaveLength(5);

    const noDatabase = checkRoster(roster.filter((a) => a.role !== "database"));
    expect(noDatabase).toEqual([
      {
        file: "agents",
        line: 1,
        code: "specialist_without_agent",
        message: "Especialista sem ficha em InProgress: database.",
      },
    ]);

    const wrongState = checkRoster([
      ...roster.filter((a) => a.role !== "database"),
      agent("database", ["QA"]),
    ]);
    expect(wrongState.map((p) => p.message)).toEqual([
      "Especialista sem ficha em InProgress: database.",
    ]);
  });
});
