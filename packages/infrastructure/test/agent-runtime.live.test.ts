import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunOptions } from "@friday/application";
import { describe, expect, it } from "vitest";
import { ClaudeAgentSdkRuntime } from "../src/index.ts";

const KINDS = [
  "qaReport",
  "reviewVerdict",
  "triage",
  "criteria",
  "workReport",
  "diagnosis",
] as const;

function setup() {
  const cwd = mkdtempSync(join(tmpdir(), "friday-live-cwd-"));
  const configRoot = mkdtempSync(join(tmpdir(), "friday-live-cfg-"));
  writeFileSync(
    join(configRoot, "prompt.md"),
    "Responda só pela saída estruturada, com valores de exemplo.",
  );
  return { cwd, configRoot };
}

const agent = (over: Partial<AgentRunOptions>): AgentRunOptions => ({
  model: "haiku",
  maxBudgetUsd: 0.05,
  maxTurns: 5,
  timeoutMs: 120000,
  tools: [],
  allowedTools: [],
  bashAllow: [],
  promptFile: "prompt.md",
  outputKind: null,
  ...over,
});

describe.skipIf(process.env.FRIDAY_LIVE !== "1")("ClaudeAgentSdkRuntime (live)", () => {
  for (const kind of KINDS) {
    it(`produces the ${kind} contract`, { timeout: 180_000 }, async () => {
      const { cwd, configRoot } = setup();
      const out = await new ClaudeAgentSdkRuntime().run({
        cwd,
        configRoot,
        prompt: `Gere um exemplo do contrato ${kind}.`,
        agent: agent({ outputKind: kind }),
      });
      expect(out.model).not.toBeNull();
      expect(["misconfigured", "failed"]).not.toContain(out.status);
    });
  }

  it("fails closed on tools that are not pre-approved", { timeout: 180_000 }, async () => {
    const { cwd, configRoot } = setup();
    await new ClaudeAgentSdkRuntime().run({
      cwd,
      configRoot,
      prompt:
        "Crie o arquivo probe.txt com a ferramenta Write e, se ela falhar, com a ferramenta Bash.",
      agent: agent({ tools: ["Read", "Bash", "Write"] }),
    });
    expect(existsSync(join(cwd, "probe.txt"))).toBe(false);
  });
});
