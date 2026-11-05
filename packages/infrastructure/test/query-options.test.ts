import { contractJsonSchema } from "@friday/contracts";
import type { AgentRunRequest } from "@friday/application";
import { describe, expect, it } from "vitest";
import { buildQueryOptions } from "../src/index.ts";

const request = (outputKind: AgentRunRequest["agent"]["outputKind"]): AgentRunRequest => ({
  cwd: "/work",
  prompt: "p",
  configRoot: "/cfg",
  agent: {
    model: "sonnet",
    states: ["InProgress"],
    maxBudgetUsd: 0.5,
    maxTurns: 7,
    timeoutMs: 1000,
    tools: ["Read"],
    allowedTools: ["mcp__friday__qa_report"],
    bashAllow: [],
    promptFile: "prompt.md",
    outputKind,
  },
});
const build = (outputKind: AgentRunRequest["agent"]["outputKind"]) => {
  const abortController = new AbortController();
  const options = buildQueryOptions({
    request: request(outputKind),
    env: { PATH: "b" },
    systemPromptAppend: "texto",
    abortController,
  });
  return { options, abortController };
};

describe("buildQueryOptions", () => {
  it("builds the exact sdk options", () => {
    const { options, abortController } = build(null);
    expect(options).toMatchObject({
      cwd: "/work",
      env: { PATH: "b" },
      model: "sonnet",
      tools: ["Read"],
      allowedTools: ["mcp__friday__qa_report"],
      permissionMode: "dontAsk",
      settingSources: [],
      strictMcpConfig: true,
      maxTurns: 7,
      maxBudgetUsd: 0.5,
      systemPrompt: { type: "preset", preset: "claude_code", append: "texto" },
      persistSession: false,
      abortController,
    });
    expect("outputFormat" in options).toBe(false);
    for (const key of ["plugins", "canUseTool", "hooks", "mcpServers"]) {
      expect(key in options).toBe(false);
    }
    expect(build("qaReport").options.outputFormat).toEqual({
      type: "json_schema",
      schema: contractJsonSchema("qaReport"),
    });
  });
});
