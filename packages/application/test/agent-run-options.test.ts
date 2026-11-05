import type { AgentConfig } from "@friday/contracts";
import { describe, expect, it } from "vitest";
import { toAgentRunOptions } from "../src/index.ts";

const qa: AgentConfig = {
  role: "qa",
  states: ["QA"],
  model: "sonnet",
  max_budget_usd: 1.5,
  max_turns: 40,
  timeout_s: 3600,
  tools: ["Read", "Glob", "Grep", "Bash"],
  mcp_tools: ["qa_report", "issue_comment"],
  prompt_file: "prompts/qa.md",
};

describe("toAgentRunOptions", () => {
  it("maps an agent file to run options", () => {
    expect(toAgentRunOptions(qa)).toEqual({
      model: "sonnet",
      states: ["QA"],
      maxBudgetUsd: 1.5,
      maxTurns: 40,
      timeoutMs: 3600000,
      tools: ["Read", "Glob", "Grep", "Bash"],
      allowedTools: ["mcp__friday__qa_report", "mcp__friday__issue_comment"],
      bashAllow: [],
      promptFile: "prompts/qa.md",
      outputKind: null,
    });
    const full = toAgentRunOptions({ ...qa, bash_allow: ["pnpm *"], output: "qaReport" });
    expect(full.bashAllow).toEqual(["pnpm *"]);
    expect(full.outputKind).toBe("qaReport");
  });
});
