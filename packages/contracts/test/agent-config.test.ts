import { describe, expect, it } from "vitest";
import {
  AGENT_STATES,
  BUILTIN_TOOLS,
  MCP_TOOLS,
  agentConfigSchema,
  validateContract,
} from "../src/index.ts";

const qa = {
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

describe("agentConfigSchema", () => {
  it("accepts agent files and rejects invalid fields", () => {
    expect(agentConfigSchema.safeParse(qa).success).toBe(true);
    expect(
      agentConfigSchema.safeParse({ ...qa, bash_allow: ["pnpm *"], output: "qaReport" }).success,
    ).toBe(true);

    const invalid: Array<Record<string, unknown>> = [
      { model: "gpt" },
      { max_turns: 1.5 },
      { max_budget_usd: 0 },
      { states: [] },
      { states: undefined },
      { states: ["Todo"] },
      { output: "qa_report" },
      { role: "Qa" },
      { tools: ["WebFetch"] },
      { mcp_tools: ["pr_merge"] },
      { other: 1 },
      { timeout_s: 0 },
      { prompt_file: " " },
      { role: undefined },
    ];
    for (const patch of invalid) {
      const result = agentConfigSchema.safeParse({ ...qa, ...patch });
      expect(result.success, JSON.stringify(patch)).toBe(false);
    }
    for (const key of Object.keys(qa)) {
      const { [key as keyof typeof qa]: _removed, ...rest } = qa;
      expect(agentConfigSchema.safeParse(rest).success, key).toBe(false);
    }
  });

  it("lists the accepted tools and states outside the contract kinds", () => {
    expect([...BUILTIN_TOOLS]).toEqual(["Read", "Glob", "Grep", "Bash", "Edit", "Write"]);
    expect(BUILTIN_TOOLS).not.toContain("WebFetch");
    expect(BUILTIN_TOOLS).not.toContain("WebSearch");
    expect([...MCP_TOOLS].sort()).toEqual(
      [
        "criteria_set",
        "work_report",
        "git_push",
        "pr_create",
        "qa_report",
        "pr_diff",
        "review_verdict",
        "issue_comment",
      ].sort(),
    );
    expect([...AGENT_STATES]).toEqual(["InProgress", "QA", "InReview"]);
    for (const kind of ["factoryConfig", "agentConfig"]) {
      const result = validateContract(kind as never, {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations[0]?.code).toBe("unknown_kind");
    }
  });
});
