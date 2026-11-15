import { SPECIALIST_ALLOWED_MCP } from "@friday/application";
import { agentConfigSchema, type AgentConfig } from "@friday/contracts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isBashAllowed } from "../src/bash-allow.ts";
import { agentExtraProblems } from "../src/factory-config-agent-checks.ts";
import { parseYaml, type ParsedYaml } from "../src/factory-config-yaml.ts";
import { loadFactoryConfig } from "../src/index.ts";

const registry = resolve(import.meta.dirname, "../../../registry");
const FIRST_LINE = {
  generic:
    "You are the generic implementer of this workspace. Your domain: any task of the issue, in .NET 10 with xUnit.",
  frontend:
    "You are the frontend specialist of this workspace. Your domain: Blazor pages and components and their tests, in .NET 10 with xUnit.",
} as const;
type Role = keyof typeof FIRST_LINE;

function load(role: Role): {
  text: string;
  parsed: ParsedYaml;
  agent: AgentConfig;
  prompt: string;
} {
  const text = readFileSync(join(registry, `agents/${role}.yaml`), "utf8");
  const result = parseYaml(text);
  if (!result.ok) throw new Error(`${role}.yaml is not valid YAML`);
  const prompt = readFileSync(join(registry, `prompts/${role}.md`), "utf8");
  return { text, parsed: result.parsed, agent: result.parsed.value as AgentConfig, prompt };
}

function expectApproved(role: Role): void {
  const { parsed, agent, text } = load(role);
  expect(agentConfigSchema.safeParse(agent).success).toBe(true);
  expect(agent.role).toBe(role);
  expect(agent.states).toEqual(["InProgress"]);
  expect(agent.model).toBe("sonnet");
  expect(agent.max_budget_usd).toBe(3);
  expect(agent.max_turns).toBe(80);
  expect(agent.timeout_s).toBe(3600);
  expect(agent.output).toBe("workReport");
  expect(agent.prompt_file).toBe(`prompts/${role}.md`);
  expect(agent.tools).toEqual(["Read", "Glob", "Grep", "Bash", "Edit", "Write"]);
  expect(agent.mcp_tools).toEqual([
    "work_report",
    "git_push",
    "pr_create",
    "pr_diff",
    "issue_comment",
  ]);
  expect(agent.bash_allow).toEqual([
    "dotnet restore",
    "dotnet build",
    "dotnet test",
    "git status",
    "git diff",
  ]);
  expect(agentExtraProblems(parsed, `agents/${role}.yaml`, registry)).toEqual([]);
  const granted = agent.mcp_tools.map((t) => "mcp__friday__" + t).sort();
  expect(granted).toEqual([...SPECIALIST_ALLOWED_MCP].sort());
  expect(text).not.toMatch(/sk-ant-|ghp_|github_pat_/);
}

describe("generic and frontend agent definitions", () => {
  it("accepts the generic agent config with the approved limits and permissions", () => {
    expectApproved("generic");
  });

  it("accepts the frontend agent config with the approved limits and permissions", () => {
    expectApproved("frontend");
  });

  it("prompts target .NET 10 and xUnit and keep the roles apart", () => {
    for (const role of ["generic", "frontend"] as const) {
      const { prompt } = load(role);
      expect(prompt.split("\n")[0]).toBe(FIRST_LINE[role]);
      for (const s of [
        ".NET 10",
        "xUnit",
        "dotnet test",
        "work_report",
        "Never add a dependency the issue does not name.",
      ]) {
        expect(prompt).toContain(s);
      }
      expect(prompt).not.toContain("criteria_set");
      expect(prompt).not.toMatch(/sk-ant-|ghp_|github_pat_/);
      expect(prompt.split("\n").length).toBeLessThanOrEqual(300);
    }
    const frontend = load("frontend").prompt;
    expect(frontend).toContain("Blazor");
    expect(frontend).toContain("Use no component test library.");
    expect(load("generic").prompt).not.toMatch(/backend specialist|frontend specialist/);
  });

  it("rejects malformed agent configs, forbidden commands, a missing prompt and a role mismatch", () => {
    for (const role of ["generic", "frontend"] as const) {
      const { agent } = load(role);
      expect(agentConfigSchema.safeParse({ ...agent, role: "Frontend" }).success).toBe(false);
      expect(
        agentConfigSchema.safeParse({ ...agent, mcp_tools: [...agent.mcp_tools, "nope"] }).success,
      ).toBe(false);
    }
    const { agent, text, parsed } = load("generic");
    const allow = agent.bash_allow ?? [];
    expect(isBashAllowed("dotnet test", allow)).toBe(true);
    for (const cmd of ["dotnet publish", "dotnet test; rm -rf x", "git push"]) {
      expect(isBashAllowed(cmd, allow)).toBe(false);
    }
    const dir = mkdtempSync(join(tmpdir(), "generic-agent-"));
    try {
      mkdirSync(join(dir, "agents"));
      writeFileSync(join(dir, "agents/generic.yaml"), text);
      const problems = agentExtraProblems(parsed, "agents/generic.yaml", dir);
      expect(problems.map((p) => p.code)).toContain("prompt_file_invalid");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const mismatch = agentExtraProblems(parsed, "agents/frontend.yaml", registry);
    expect(mismatch.map((p) => p.code)).toContain("role_mismatch");
  });

  it("loads the registry with generic, frontend and backend", () => {
    const result = loadFactoryConfig(registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.agents)).toEqual(
      expect.arrayContaining(["generic", "frontend", "backend"]),
    );
  });
});
