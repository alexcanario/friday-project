import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { QA_ALLOWED_MCP, QA_ALLOWED_TOOLS } from "@friday/application";
import { loadFactoryConfig } from "../src/index.ts";
import { hasSecretPrefix, scanSecrets } from "../src/factory-config-secrets.ts";
import { makeRoot, write } from "./config-helpers.ts";

const registry = resolve(import.meta.dirname, "../../../registry");
const agentText = readFileSync(resolve(registry, "agents/qa.yaml"), "utf8");
const promptText = readFileSync(resolve(registry, "prompts/qa.md"), "utf8");
const FIRST_LINE =
  "You are the QA agent of this workspace. You validate a specialist's work against the issue's acceptance criteria; you do not change the code.";

function qaRoot(agent: string = agentText): string {
  const root = makeRoot();
  write(root, "agents/qa.yaml", agent);
  write(root, "prompts/qa.md", promptText);
  return root;
}

function loadQa(root: string) {
  const result = loadFactoryConfig(root);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  const qa = result.agents["qa"];
  if (!qa) throw new Error("missing qa");
  return qa;
}

describe("QA agent definition", () => {
  it("loads the QA definition from the registry origin", () => {
    const qa = loadQa(qaRoot());
    expect(qa.states).toEqual(["QA"]);
    expect(qa.model).toBe("sonnet");
    expect(qa.max_budget_usd).toBe(1.5);
    expect(qa.max_turns).toBe(40);
    expect(qa.timeout_s).toBe(1800);
    expect(qa.tools).toEqual(["Read", "Glob", "Grep", "Bash"]);
    expect(qa.mcp_tools).toEqual(["qa_report", "issue_comment"]);
    expect(qa.bash_allow).toEqual(["pnpm test", "pnpm -r test", "git log", "git diff"]);
    expect(qa.output).toBe("qaReport");
    expect(qa.prompt_file).toBe("prompts/qa.md");
  });

  it("matches the tools and MCP names enforced by runQaStep", () => {
    const qa = loadQa(qaRoot());
    expect(qa.tools).toEqual([...QA_ALLOWED_TOOLS]);
    expect(qa.mcp_tools.map((t) => "mcp__friday__" + t)).toEqual([...QA_ALLOWED_MCP]);
    for (const t of ["Edit", "Write"]) expect(qa.tools).not.toContain(t);
    for (const t of ["git_push", "pr_create", "work_report", "criteria_set"]) {
      expect(qa.mcp_tools).not.toContain(t);
    }
  });

  it("rejects a QA definition with Edit and a prompt_file outside the root", () => {
    const diff = (tools: readonly string[]) =>
      tools.filter((t) => !(QA_ALLOWED_TOOLS as readonly string[]).includes(t));
    const withEdit = agentText.replace(/^tools:.*$/m, "tools: [Read, Glob, Grep, Bash, Edit]");
    const qa = loadQa(qaRoot(withEdit));
    expect(qa.tools).toContain("Edit");
    expect(diff(qa.tools)).toEqual(["Edit"]);
    expect(diff(loadQa(qaRoot()).tools)).toEqual([]);

    const outside = agentText.replace(/^prompt_file:.*$/m, "prompt_file: ../qa.md");
    const result = loadFactoryConfig(qaRoot(outside));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.code)).toContain("prompt_file_invalid");
  });

  it("ships a QA prompt with the Lode first line", () => {
    expect(promptText.split("\n")[0]).toBe(FIRST_LINE);
    expect(promptText).toContain("qa_report");
    expect(promptText).toContain("do not change the code");
    expect(promptText.trim()).not.toBe("");
    expect(promptText.split("\n").length).toBeLessThanOrEqual(300);
  });

  it("has no secret in the QA definition", () => {
    expect(scanSecrets(agentText, "agents/qa.yaml")).toEqual([]);
    expect(hasSecretPrefix(promptText)).toBe(false);
    const root = qaRoot(agentText + "# sk-ant-x\n");
    const result = loadFactoryConfig(root);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "agents/qa.yaml", code: "secret_value" }),
      ]),
    );
  });

  it("does not touch workflows, the package manifest or the lockfile", () => {
    const out = execFileSync(
      "git",
      [
        "diff",
        "--name-only",
        "origin/develop...HEAD",
        "--",
        ".github/workflows",
        "packages/infrastructure/package.json",
        "pnpm-lock.yaml",
      ],
      { cwd: resolve(import.meta.dirname, "../../.."), encoding: "utf8" },
    );
    expect(out.trim()).toBe("");
  });
});
