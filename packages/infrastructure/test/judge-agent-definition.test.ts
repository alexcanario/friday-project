import { JUDGE_ALLOWED_MCP, JUDGE_ALLOWED_TOOLS } from "@friday/application";
import { agentConfigSchema, type AgentConfig } from "@friday/contracts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { agentExtraProblems } from "../src/factory-config-agent-checks.ts";
import { hasSecretPrefix, scanSecrets } from "../src/factory-config-secrets.ts";
import { parseYaml, type ParsedYaml } from "../src/factory-config-yaml.ts";

const registry = resolve(import.meta.dirname, "../../../registry");
const prompt = readFileSync(join(registry, "prompts/judge.md"), "utf8");

function load(role: string): { text: string; parsed: ParsedYaml; agent: AgentConfig } {
  const text = readFileSync(join(registry, `agents/${role}.yaml`), "utf8");
  const result = parseYaml(text);
  if (!result.ok) throw new Error(`${role}.yaml is not valid YAML`);
  return { text, parsed: result.parsed, agent: result.parsed.value as AgentConfig };
}

const judge = load("judge");
const strong = load("judge-strong");
const both = [
  { role: "judge", ...judge },
  { role: "judge-strong", ...strong },
];

describe("judge agent definitions", () => {
  it("accepts the judge and judge-strong definitions", () => {
    for (const { role, parsed, agent } of both) {
      expect(agentConfigSchema.safeParse(agent).success).toBe(true);
      expect(agentExtraProblems(parsed, `agents/${role}.yaml`, registry)).toEqual([]);
    }
    expect(judge.agent).toMatchObject({
      role: "judge",
      states: ["InReview"],
      model: "sonnet",
      max_budget_usd: 1.5,
      max_turns: 40,
      timeout_s: 1800,
      tools: ["Read", "Glob", "Grep"],
      mcp_tools: ["review_verdict", "pr_diff"],
      output: "reviewVerdict",
      prompt_file: "prompts/judge.md",
    });
    expect(judge.agent.bash_allow).toBeUndefined();
    expect(strong.agent).toMatchObject({
      ...judge.agent,
      role: "judge-strong",
      model: "opus",
      max_budget_usd: 3,
    });
    expect(strong.agent.bash_allow).toBeUndefined();
  });

  it("grants exactly the tools and MCP names enforced by runJudgeStep", () => {
    for (const { agent } of both) {
      expect(agent.tools).toEqual([...JUDGE_ALLOWED_TOOLS]);
      expect(agent.mcp_tools.map((t) => "mcp__friday__" + t)).toEqual([...JUDGE_ALLOWED_MCP]);
      for (const t of ["Bash", "Edit", "Write"]) expect(agent.tools).not.toContain(t);
      for (const t of [
        "issue_comment",
        "qa_report",
        "git_push",
        "pr_create",
        "work_report",
        "criteria_set",
      ]) {
        expect(agent.mcp_tools).not.toContain(t);
      }
    }
  });

  it("rejects a malformed judge definition and flags Bash", () => {
    const agent = judge.agent;
    const withBash = { ...agent, tools: [...agent.tools, "Bash"] };
    expect(agentConfigSchema.safeParse(withBash).success).toBe(true);
    const extra = (tools: string[]) =>
      tools.filter((t) => !(JUDGE_ALLOWED_TOOLS as readonly string[]).includes(t));
    expect(extra(withBash.tools)).toEqual(["Bash"]);
    expect(extra(agent.tools)).toEqual([]);
    expect(agentConfigSchema.safeParse({ ...agent, role: "Judge" }).success).toBe(false);
    expect(
      agentConfigSchema.safeParse({ ...agent, mcp_tools: [...agent.mcp_tools, "nope"] }).success,
    ).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), "judge-agent-"));
    try {
      mkdirSync(join(dir, "agents"));
      writeFileSync(join(dir, "agents/judge.yaml"), judge.text);
      const problems = agentExtraProblems(judge.parsed, "agents/judge.yaml", dir);
      expect(problems.map((p) => p.code)).toContain("prompt_file_invalid");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(agentExtraProblems(judge.parsed, "agents/judge.yaml", registry)).toEqual([]);
  });

  it("ships a judge prompt with the five review rules", () => {
    expect(prompt.trim()).not.toBe("");
    expect(prompt.split("\n").length).toBeLessThanOrEqual(300);
    expect(prompt.split("\n")[0]).toBe(
      "You are the judge of this workspace. You review the pull request of an issue that passed QA; you do not change the code and you do not merge.",
    );
    for (const s of [
      "review_verdict",
      "pr_diff",
      "approve",
      "changes_requested",
      "reject",
      "head SHA",
      "do not change the code",
      "evidence",
      "findings",
      "Diff covers every criterion",
      "Checks are green",
      "New tests cover the change",
      "No test removed or weakened",
      "No secret or unexplained dependency",
    ]) {
      expect(prompt).toContain(s);
    }
  });

  it("judge prompt tells the judge where the head SHA comes from", () => {
    expect(prompt).toContain("head SHA given in the run prompt");
    expect(prompt).toContain("truncated");
    expect(prompt).not.toContain("Note the head SHA of the revision you reviewed");
  });

  it("has no secret in the judge definitions", () => {
    for (const { role, text } of both) {
      expect(scanSecrets(text, `agents/${role}.yaml`)).toEqual([]);
    }
    expect(hasSecretPrefix(prompt)).toBe(false);
    const dirty = scanSecrets(judge.text + "\n# sk-ant-x\n", "agents/judge.yaml");
    expect(dirty.map((p) => p.code)).toContain("secret_value");
  });
});
