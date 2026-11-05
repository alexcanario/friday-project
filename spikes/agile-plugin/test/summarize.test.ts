import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { summarizeRun } from "../src/summarize.ts";

const fx = (name: string) => resolve(import.meta.dirname, "fixtures", name);
const canUse = fx("can-use-tool.json");

describe("summarizeRun", () => {
  it("counts AskUserQuestion and reads the result", () => {
    expect(summarizeRun(fx("ask.jsonl"), canUse)).toEqual({
      tools: ["AskUserQuestion"],
      askUserQuestionCount: 2,
      canUseToolCalls: 1,
      subtype: "success",
      totalCostUsd: 0.02,
    });
    expect(summarizeRun(fx("no-ask.jsonl"), canUse).askUserQuestionCount).toBe(0);
    expect(summarizeRun(fx("error.jsonl"), canUse).subtype).toBe("error_max_turns");
  });

  it("rejects missing or duplicate result", () => {
    expect(() => summarizeRun(fx("no-result.jsonl"), canUse)).toThrow("mensagem result ausente");
    expect(() => summarizeRun(fx("two-results.jsonl"), canUse)).toThrow(
      "mais de uma mensagem result",
    );
  });
});
