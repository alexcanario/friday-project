import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { triageAgentConfigSchema } from "../src/index.ts";

const registry = resolve(import.meta.dirname, "../../../registry");

/** Flat `key: scalar | []` reader; contracts has no YAML dependency. */
function readCard(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of text.split("\n")) {
    const m = /^([a-z_]+): (.+)$/.exec(line);
    if (!m) continue;
    const raw = (m[2] as string).trim();
    out[m[1] as string] = raw === "[]" ? [] : /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  }
  return out;
}

const card = readCard(readFileSync(join(registry, "agents/triage.yaml"), "utf8"));

describe("triageAgentConfigSchema", () => {
  it("parses the registry triage card", () => {
    expect(triageAgentConfigSchema.parse(card)).toEqual({
      role: "triage",
      model: "sonnet",
      max_budget_usd: 0.5,
      max_turns: 10,
      timeout_s: 600,
      tools: [],
      mcp_tools: [],
      bash_allow: [],
      prompt_file: "prompts/triage.md",
    });
  });

  it("rejects states, tools, wrong role, bad limits and missing prompt_file", () => {
    const withoutPrompt = Object.fromEntries(
      Object.entries(card).filter(([key]) => key !== "prompt_file"),
    );
    const variants: Record<string, unknown>[] = [
      { ...card, states: ["Todo"] },
      { ...card, tools: ["Read"] },
      { ...card, mcp_tools: ["criteria_set"] },
      { ...card, bash_allow: ["git diff"] },
      { ...card, role: "backend" },
      { ...card, model: "gpt" },
      { ...card, max_turns: 0 },
      { ...card, max_budget_usd: 0 },
      withoutPrompt,
    ];
    for (const v of variants) expect(triageAgentConfigSchema.safeParse(v).success).toBe(false);
  });
});
