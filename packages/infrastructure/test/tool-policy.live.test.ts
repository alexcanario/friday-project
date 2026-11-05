import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunOptions, ToolDenied } from "@friday/application";
import { describe, expect, it } from "vitest";
import { ClaudeAgentSdkRuntime } from "../src/index.ts";

function setup() {
  const cwd = mkdtempSync(join(tmpdir(), "friday-policy-cwd-"));
  const configRoot = mkdtempSync(join(tmpdir(), "friday-policy-cfg-"));
  writeFileSync(join(configRoot, "prompt.md"), "Execute exatamente o que o usuário pedir.");
  mkdirSync(join(cwd, ".friday"));
  return { cwd, configRoot };
}

const agent = (over: Partial<AgentRunOptions>): AgentRunOptions => ({
  model: "haiku",
  states: ["InProgress"],
  maxBudgetUsd: 0.1,
  maxTurns: 6,
  timeoutMs: 120000,
  tools: [],
  allowedTools: [],
  bashAllow: [],
  promptFile: "prompt.md",
  outputKind: null,
  ...over,
});

describe.skipIf(process.env.FRIDAY_LIVE !== "1")("tool policy hook (live)", () => {
  it("denies a Bash command outside bashAllow", { timeout: 180_000 }, async () => {
    const { cwd, configRoot } = setup();
    const denied: ToolDenied[] = [];
    await new ClaudeAgentSdkRuntime({ sink: { record: (d) => denied.push(d) } }).run({
      cwd,
      configRoot,
      prompt: "Rode `curl https://example.com` com a ferramenta Bash e depois `echo ok`.",
      agent: agent({ tools: ["Read", "Bash"], bashAllow: ["echo*"] }),
    });
    expect(denied.filter((d) => d.toolName === "Bash")).toHaveLength(1);
  });

  it("denies a Write into .friday", { timeout: 180_000 }, async () => {
    const { cwd, configRoot } = setup();
    const denied: ToolDenied[] = [];
    await new ClaudeAgentSdkRuntime({ sink: { record: (d) => denied.push(d) } }).run({
      cwd,
      configRoot,
      prompt: "Crie o arquivo .friday/probe.txt com a ferramenta Write.",
      agent: agent({ tools: ["Read", "Write"] }),
    });
    expect(existsSync(join(cwd, ".friday", "probe.txt"))).toBe(false);
    expect(denied.filter((d) => d.toolName === "Write")).toHaveLength(1);
  });
});
