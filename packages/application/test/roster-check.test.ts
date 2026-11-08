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

const noBackendProblem = [
  {
    file: "agents",
    line: 1,
    code: "specialist_without_agent",
    message: "Especialista sem ficha em InProgress: backend.",
  },
];

const base = (): AgentConfig[] => [
  agent("qa", ["QA"]),
  agent("judge", ["InReview"]),
  agent("backend", ["InProgress"]),
];

describe("checkRoster", () => {
  it("accepts a roster with only the backend specialist", () => {
    expect(checkRoster(base())).toEqual([]);
  });

  it("rejects a roster without the backend specialist", () => {
    const roster = [
      agent("qa", ["QA"]),
      agent("judge", ["InReview"]),
      agent("database", ["InProgress"]),
    ];
    expect(checkRoster(roster)).toEqual(noBackendProblem);
  });

  it("rejects a backend ficha outside InProgress", () => {
    const roster = [
      agent("qa", ["QA"]),
      agent("judge", ["InReview"]),
      agent("database", ["InProgress"]),
      agent("backend", ["QA"]),
    ];
    expect(checkRoster(roster)).toEqual(noBackendProblem);
  });

  it("still requires an agent for each state", () => {
    const states: Array<[string, string]> = [
      ["qa", "QA"],
      ["judge", "InReview"],
    ];
    for (const [role, state] of states) {
      expect(checkRoster(base().filter((a) => a.role !== role))).toEqual([
        {
          file: "agents",
          line: 1,
          code: "state_without_agent",
          message: `Estado sem agente: ${state}.`,
        },
      ]);
    }
  });

  it("accepts extra specialist fichas", () => {
    const extras = ["database", "frontend", "infra", "security"].map((r) =>
      agent(r, ["InProgress"]),
    );
    expect(checkRoster([...base(), ...extras])).toEqual([]);
    expect(checkRoster([...base(), agent("database", ["InProgress"])])).toEqual([]);
  });
});
