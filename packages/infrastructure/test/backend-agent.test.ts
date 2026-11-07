import { SPECIALIST_ALLOWED_MCP } from "@friday/application";
import { agentConfigSchema, type AgentConfig } from "@friday/contracts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { agentExtraProblems } from "../src/factory-config-agent-checks.ts";
import { isBashAllowed } from "../src/bash-allow.ts";
import { parseYaml, type ParsedYaml } from "../src/factory-config-yaml.ts";

const registry = resolve(import.meta.dirname, "../../../registry");
const yamlText = readFileSync(join(registry, "agents/backend.yaml"), "utf8");
const prompt = readFileSync(join(registry, "prompts/backend.md"), "utf8");
const result = parseYaml(yamlText);
if (!result.ok) throw new Error("backend.yaml is not valid YAML");
const parsed: ParsedYaml = result.parsed;
const agent = parsed.value as AgentConfig;

describe("backend agent definition", () => {
  it("accepts the backend agent config", () => {
    expect(agentConfigSchema.safeParse(agent).success).toBe(true);
    expect(agent.role).toBe("backend");
    expect(agent.states).toEqual(["InProgress"]);
    expect(agent.output).toBe("workReport");
    expect(agent.tools).toEqual(["Read", "Glob", "Grep", "Bash", "Edit", "Write"]);
    expect(agentExtraProblems(parsed, "agents/backend.yaml", registry)).toEqual([]);
  });

  it("grants exactly the specialist MCP tools", () => {
    const granted = agent.mcp_tools.map((t) => "mcp__friday__" + t).sort();
    expect(granted).toEqual([...SPECIALIST_ALLOWED_MCP].sort());
    expect(agent.mcp_tools).not.toContain("qa_report");
    expect(agent.mcp_tools).not.toContain("review_verdict");
  });

  it("prompt targets .NET 10 and xUnit", () => {
    expect(agent.prompt_file).toBe("prompts/backend.md");
    expect(prompt.trim()).not.toBe("");
    expect(prompt.split("\n")[0]).toMatch(
      /^You are the backend specialist of this workspace\. Your domain:/,
    );
    for (const s of [".NET 10", "xUnit", "dotnet test", "work_report"]) {
      expect(prompt).toContain(s);
    }
    expect(prompt.split("\n").length).toBeLessThanOrEqual(300);
  });

  it("rejects a malformed backend agent config", () => {
    expect(agentConfigSchema.safeParse({ ...agent, role: "Backend" }).success).toBe(false);
    expect(
      agentConfigSchema.safeParse({ ...agent, mcp_tools: [...agent.mcp_tools, "nope"] }).success,
    ).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), "backend-agent-"));
    try {
      mkdirSync(join(dir, "agents"));
      writeFileSync(join(dir, "agents/backend.yaml"), yamlText);
      const problems = agentExtraProblems(parsed, "agents/backend.yaml", dir);
      expect(problems.map((p) => p.code)).toContain("prompt_file_invalid");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the approved limits", () => {
    expect(agent.model).toBe("sonnet");
    expect(agent.max_budget_usd).toBe(3);
    expect(agent.max_turns).toBe(80);
    expect(agent.timeout_s).toBe(3600);
  });

  it("allows only the approved dotnet and git commands", () => {
    expect(agent.bash_allow).toEqual([
      "dotnet restore",
      "dotnet build",
      "dotnet test",
      "git status",
      "git diff",
    ]);
    expect(isBashAllowed("dotnet test", agent.bash_allow)).toBe(true);
    expect(isBashAllowed("dotnet test; rm -rf x", agent.bash_allow)).toBe(false);
    expect(isBashAllowed("git push", agent.bash_allow)).toBe(false);
    expect(isBashAllowed("dotnet publish", agent.bash_allow)).toBe(false);
  });

  it("has no secret in the backend definition", () => {
    expect(yamlText).not.toMatch(/sk-ant-|ghp_|github_pat_/);
    expect(prompt).not.toMatch(/sk-ant-|ghp_|github_pat_/);
  });
});
