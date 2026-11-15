import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { turnContextTokens } from "../src/run-result.ts";
import { result } from "./runtime-helpers.ts";

function assistant(
  usage: Record<string, unknown> | undefined,
  parent: string | null = null,
): SDKMessage {
  return {
    type: "assistant",
    parent_tool_use_id: parent,
    message: usage === undefined ? {} : { usage },
  } as unknown as SDKMessage;
}

describe("turnContextTokens", () => {
  it("sums input and cache tokens of one turn", () => {
    const full = {
      input_tokens: 1000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 5000,
    };
    expect(turnContextTokens(assistant(full))).toBe(6000);
    const partial = { input_tokens: 700, cache_read_input_tokens: null };
    expect(turnContextTokens(assistant(partial))).toBe(700);
  });

  it("ignores unreadable and subagent turns", () => {
    expect(turnContextTokens(result())).toBeNull();
    expect(turnContextTokens(assistant(undefined))).toBeNull();
    expect(turnContextTokens(assistant({ input_tokens: "x" }))).toBeNull();
    expect(turnContextTokens(assistant({ input_tokens: -1 }))).toBeNull();
    expect(
      turnContextTokens(assistant({ input_tokens: 1, cache_read_input_tokens: 1.5 })),
    ).toBeNull();
    expect(turnContextTokens(assistant({ input_tokens: 1 }, "toolu_1"))).toBeNull();
  });
});
