import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { ClaudeAgentSdkRuntime } from "../src/index.ts";
import { fakeQuery, init, makeRequest, result } from "./runtime-helpers.ts";

const turn = (
  input: number,
  read: number,
  creation: number,
  parent: string | null = null,
): SDKMessage =>
  ({
    type: "assistant",
    parent_tool_use_id: parent,
    message: {
      usage: {
        input_tokens: input,
        cache_read_input_tokens: read,
        cache_creation_input_tokens: creation,
      },
    },
  }) as unknown as SDKMessage;

const TURNS: SDKMessage[] = [turn(100, 0, 0), turn(100, 8000, 900), turn(4000, 0, 0)];
const run = (messages: SDKMessage[]) =>
  new ClaudeAgentSdkRuntime({ query: fakeQuery(messages) }).run(makeRequest());

describe("ClaudeAgentSdkRuntime peakContextTokens", () => {
  it("reports the largest turn context", async () => {
    const finished = await run([init(), ...TURNS, result()]);
    expect(finished.peakContextTokens).toBe(9000);
    expect(finished.tokens).toEqual({ input: 11, output: 22, cacheRead: 33, cacheCreation: 44 });
    expect(finished.costUsd).toBe(0.5);
    expect(finished.numTurns).toBe(2);
  });

  it("ignores subagent turns", async () => {
    const [a, b, c] = TURNS as [SDKMessage, SDKMessage, SDKMessage];
    const finished = await run([init(), a, turn(90000, 0, 0, "toolu_1"), b, c, result()]);
    expect(finished.peakContextTokens).toBe(9000);
  });

  it("reports null without assistant turns or without a result", async () => {
    const none = await run([init(), result()]);
    expect(none.peakContextTokens).toBeNull();
    const expired = await run([init(), ...TURNS]);
    expect(expired.peakContextTokens ?? null).toBeNull();
  });
});
