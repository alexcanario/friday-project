import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunOptions, AgentRunRequest } from "@friday/application";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type QueryFn = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export const PROMPT = "Você é um agente de teste.";

export function makeRequest(over: Partial<AgentRunOptions> = {}): AgentRunRequest {
  const configRoot = mkdtempSync(join(tmpdir(), "friday-rt-"));
  mkdirSync(join(configRoot), { recursive: true });
  writeFileSync(join(configRoot, "prompt.md"), PROMPT);
  const cwd = mkdtempSync(join(tmpdir(), "friday-wt-"));
  return {
    cwd,
    prompt: "faça",
    configRoot,
    agent: {
      model: "sonnet",
      states: ["InProgress"],
      maxBudgetUsd: 0.5,
      maxTurns: 10,
      timeoutMs: 60000,
      tools: ["Read"],
      allowedTools: [],
      bashAllow: [],
      promptFile: "prompt.md",
      outputKind: null,
      ...over,
    },
  };
}

export const init = (tools: string[] = ["Read", "StructuredOutput"]): SDKMessage =>
  ({ type: "system", subtype: "init", model: "m-init", tools }) as unknown as SDKMessage;

export function result(over: Record<string, unknown> = {}): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    total_cost_usd: 0.5,
    num_turns: 2,
    duration_ms: 100,
    usage: { input_tokens: 99, output_tokens: 99 },
    modelUsage: {
      a: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 4,
      },
      b: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadInputTokens: 30,
        cacheCreationInputTokens: 40,
      },
    },
    ...over,
  } as unknown as SDKMessage;
}

/** Fake query yielding the messages, then optionally throwing like the real SDK. */
export function fakeQuery(messages: SDKMessage[], thenThrow?: Error): QueryFn {
  return async function* () {
    for (const m of messages) yield m;
    if (thenThrow) throw thenThrow;
  };
}
