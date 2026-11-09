import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { criteriaSchema, triageSchema } from "@friday/contracts";

const prompt = readFileSync(
  resolve(import.meta.dirname, "../../../registry/prompts/triage.md"),
  "utf8",
);

function jsonExample(): {
  specialist: string;
  reason: string;
  criteria: Array<Record<string, unknown>>;
} {
  const match = /```json\n([\s\S]*?)\n```/.exec(prompt);
  if (match === null || match[1] === undefined) throw new Error("no json block in prompt");
  return JSON.parse(match[1]);
}

describe("triage prompt criteria format", () => {
  it("the json example is the full response with specialist, reason and a criteria list", () => {
    const example = jsonExample();
    expect(Object.keys(example).sort()).toEqual(["criteria", "reason", "specialist"]);
    expect(Array.isArray(example.criteria)).toBe(true);
    expect(example.criteria.length).toBeGreaterThanOrEqual(2);
  });

  it("the prompt says criteria is the list with no object around it", () => {
    const outside = prompt.replace(/```json\n[\s\S]*?\n```/, "");
    expect(outside).toContain("`criteria` is the list");
    expect(outside).toContain("no object around it");
    expect(prompt).not.toMatch(/with only the\s+`criteria`\s+key/);
  });

  it("the json example passes triageSchema and its criteria pass criteriaSchema", () => {
    const example = jsonExample();
    expect(triageSchema.safeParse(example).success).toBe(true);
    expect(criteriaSchema.safeParse({ criteria: example.criteria }).success).toBe(true);
    expect(example.criteria[0]).toMatchObject({ index: 1, proof: { kind: "command" } });
    expect(example.criteria[1]).toMatchObject({ index: 2, proof: { kind: "browser" } });
  });

  it("the prompt shows a browser proof and says when to use it", () => {
    const example = jsonExample();
    expect(example.criteria[1]).toMatchObject({ index: 2, proof: { kind: "browser" } });
    const sentence = prompt
      .split(/(?<=[.!?])\s+|\n/)
      .find((s) => /\bwhen\b|\bonly\b/i.test(s) && s.includes("browser"));
    expect(sentence).toBeDefined();
  });

  it("free-text criteria, a missing proof and index 0 are rejected by criteriaSchema", () => {
    expect(
      criteriaSchema.safeParse({ criteria: ["Critério: o README contém essa linha."] }).success,
    ).toBe(false);
    expect(criteriaSchema.safeParse({ criteria: [{ index: 1, claim: "x" }] }).success).toBe(false);
    expect(
      criteriaSchema.safeParse({
        criteria: [{ index: 0, claim: "x", proof: { kind: "command", command: "true" } }],
      }).success,
    ).toBe(false);
    expect(prompt).not.toContain("copied as written, one item per criterion");
  });

  it("the prompt keeps the no-invention rule", () => {
    expect(prompt).toContain("Do not invent criteria");
  });
});
