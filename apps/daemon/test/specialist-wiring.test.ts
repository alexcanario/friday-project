import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentRunOptions } from "@friday/application";
import { assertSpecialistAgentConfig, createSpecialistBranch } from "../src/index.ts";
import type { SpecialistBranchDeps } from "../src/index.ts";

const validAgent: AgentRunOptions = {
  model: "sonnet",
  states: ["InProgress"],
  maxBudgetUsd: 3,
  maxTurns: 80,
  timeoutMs: 3600000,
  tools: ["Read", "Glob", "Grep", "Bash", "Edit", "Write"],
  allowedTools: [
    "mcp__friday__criteria_set",
    "mcp__friday__work_report",
    "mcp__friday__git_push",
    "mcp__friday__pr_create",
    "mcp__friday__pr_diff",
    "mcp__friday__issue_comment",
  ],
  bashAllow: ["dotnet restore", "dotnet build", "dotnet test", "git status", "git diff"],
  promptFile: "prompts/backend.md",
  outputKind: "workReport",
};

const MESSAGE = "A ficha do especialista é inválida.";
const variations: Record<string, Partial<AgentRunOptions>> = {
  qaReport: { outputKind: "qaReport" },
  "states QA": { states: ["QA"] },
  "states two": { states: ["InProgress", "QA"] },
  "budget zero": { maxBudgetUsd: 0 },
  "budget NaN": { maxBudgetUsd: NaN },
  "tool WebFetch": { tools: ["Read", "WebFetch"] as unknown as AgentRunOptions["tools"] },
  "mcp review_verdict": {
    allowedTools: ["mcp__friday__review_verdict"] as unknown as AgentRunOptions["allowedTools"],
  },
  "bash metachar": { bashAllow: ["dotnet test; rm -rf /"] },
  "bash glob": { bashAllow: ["git diff *"] },
  "prompt dotdot": { promptFile: "../x.md" },
  "prompt absolute": { promptFile: "/etc/x.md" },
  "prompt empty": { promptFile: "" },
};

describe("assertSpecialistAgentConfig", () => {
  it("accepts a valid specialist ficha", () => {
    expect(() => assertSpecialistAgentConfig(validAgent)).not.toThrow();
  });

  it("rejects an invalid specialist ficha", () => {
    for (const [name, change] of Object.entries(variations)) {
      expect(() => assertSpecialistAgentConfig({ ...validAgent, ...change }), name).toThrow(
        new Error(MESSAGE),
      );
    }
  });
});

describe("createSpecialistBranch", () => {
  function deps(root: string, issues: { number: number }[]) {
    const create = vi.fn();
    const run = vi.fn();
    const logs: string[] = [];
    const d = {
      projectId: "p",
      root,
      worktreesRoot: join(root, "worktrees"),
      compose: { agent: validAgent },
      github: {
        listIssuesByLabel: vi.fn(() =>
          Promise.resolve(issues.map((i) => ({ ...i, title: "T", body: "B", labels: ["friday"] }))),
        ),
      },
      worktrees: { create, list: vi.fn() },
      runtime: { run },
      now: () => new Date("2026-11-08T03:00:00.000Z"),
      log: (m: string) => logs.push(m),
    } as unknown as SpecialistBranchDeps;
    return { d, create, run, logs };
  }

  it("fails closed without factory.yaml or without the issue", async () => {
    const empty = mkdtempSync(join(tmpdir(), "friday-spec-"));
    const a = deps(empty, [{ number: 7 }]);
    await expect(createSpecialistBranch(a.d)(7)).resolves.toEqual({
      applied: false,
      feedback: null,
    });
    expect(a.create).not.toHaveBeenCalled();
    expect(a.run).not.toHaveBeenCalled();
    expect(a.logs).toContain(
      "Falha no especialista da issue 7: o factory.yaml está inválido ou ausente.",
    );

    const fixture = join(
      import.meta.dirname,
      "../../../packages/infrastructure/test/fixtures/valid",
    );
    const b = deps(fixture, [{ number: 8 }]);
    await expect(createSpecialistBranch(b.d)(7)).resolves.toEqual({
      applied: false,
      feedback: null,
    });
    expect(b.create).not.toHaveBeenCalled();
    expect(b.run).not.toHaveBeenCalled();
    expect(b.logs.some((m) => m.includes("issue 7"))).toBe(true);
  });
});
