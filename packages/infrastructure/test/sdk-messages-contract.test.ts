import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRunRequest } from "@friday/application";
import { describe, expect, it } from "vitest";
import { ClaudeAgentSdkRuntime } from "../src/index.ts";
import { fakeQuery } from "./runtime-helpers.ts";

const dir = join(import.meta.dirname, "fixtures/sdk-messages");

function request(): AgentRunRequest {
  const configRoot = mkdtempSync(join(tmpdir(), "friday-contract-"));
  writeFileSync(join(configRoot, "prompt.md"), "p");
  return {
    cwd: configRoot,
    prompt: "x",
    configRoot,
    agent: {
      model: "sonnet",
      maxBudgetUsd: 0.5,
      maxTurns: 10,
      timeoutMs: 60000,
      tools: ["Glob", "Grep", "Read"],
      allowedTools: ["mcp__spike__record"],
      bashAllow: [],
      promptFile: "prompt.md",
      outputKind: null,
    },
  };
}

async function replay(name: string, fails: boolean) {
  const lines = readFileSync(join(dir, `${name}.messages.jsonl`), "utf8").trim().split("\n");
  const messages = lines.map((l) => JSON.parse(l) as SDKMessage);
  const query = fakeQuery(messages, fails ? new Error("exit 1") : undefined);
  return new ClaudeAgentSdkRuntime({ query, env: {} }).run(request());
}

describe("recorded sdk messages", () => {
  it("reprocesses the recorded messages", async () => {
    expect(await replay("normal", false)).toMatchObject({
      status: "succeeded",
      costUsd: 0.0489146,
      numTurns: 3,
      durationMs: 6933,
      model: "claude-opus-5-5",
      tokens: { input: 1213, output: 539, cacheRead: 6221, cacheCreation: 7417 },
      output: null,
    });
    expect(await replay("budget", true)).toMatchObject({
      status: "budget_exceeded",
      costUsd: 0.0190368,
      numTurns: 1,
      tokens: { input: 1211, output: 108, cacheRead: 2922, cacheCreation: 3299 },
    });
    expect(await replay("turns", true)).toMatchObject({ status: "turns_exceeded", numTurns: 2 });
  });
});
