import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseJsonl, summarizeMessages } from "../src/summarize.ts";

const load = (name: string) =>
  parseJsonl(readFileSync(resolve(import.meta.dirname, "fixtures", name), "utf8"));

describe("summarizeMessages", () => {
  it("summarizes ok, bad output, missing result, two results and budget runs", () => {
    expect(summarizeMessages(load("ok.jsonl"))).toEqual({
      tools: ["Read", "Glob", "Grep", "mcp__spike__record", "StructuredOutput"],
      subtype: "success",
      totalCostUsd: 0.0123,
      numTurns: 2,
      structuredOutputValid: true,
    });
    expect(summarizeMessages(load("bad-output.jsonl")).structuredOutputValid).toBe(false);
    expect(() => summarizeMessages(load("no-result.jsonl"))).toThrow("mensagem result ausente");
    expect(() => summarizeMessages(load("two-results.jsonl"))).toThrow(
      "mais de uma mensagem result",
    );
    expect(summarizeMessages(load("budget.jsonl")).subtype).toBe("error_max_budget_usd");
  });
});
