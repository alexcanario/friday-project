import { describe, expect, it } from "vitest";
import { RUN_STATUSES, runFinishedSchema, validateContract } from "../src/index.ts";

const full = {
  status: "succeeded",
  subtype: "success",
  model: "claude-opus-5-5",
  costUsd: 0.5,
  tokens: { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 },
  numTurns: 2,
  durationMs: 100,
  output: { a: 1 },
  violations: [{ code: "required_field", path: "x", message: "m" }],
};
const nulls = {
  ...full,
  subtype: null,
  model: null,
  costUsd: null,
  tokens: null,
  numTurns: null,
  durationMs: null,
  output: null,
  violations: [],
};
const ok = (v: unknown) => runFinishedSchema.safeParse(v).success;

describe("runFinishedSchema", () => {
  it("accepts run results and rejects invalid fields", () => {
    expect(ok(full)).toBe(true);
    expect(ok(nulls)).toBe(true);
    expect(ok({ ...full, status: "ok" })).toBe(false);
    expect(ok({ ...full, costUsd: -1 })).toBe(false);
    expect(ok({ ...full, numTurns: 1.5 })).toBe(false);
    expect(ok({ ...full, tokens: { ...full.tokens, input: -1 } })).toBe(false);
    expect(ok({ ...full, tokens: { ...full.tokens, x: 1 } })).toBe(false);
    expect(ok({ ...full, x: 1 })).toBe(false);
    for (const key of Object.keys(full)) {
      const rest = Object.entries(full).filter(([name]) => name !== key);
      expect(ok(Object.fromEntries(rest)), key).toBe(false);
    }
    expect(ok({ ...full, violations: [{ code: "a" }] })).toBe(false);
  });

  it("stays outside the contract kinds", () => {
    const r = validateContract("runFinished" as never, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0]?.code).toBe("unknown_kind");
    expect([...RUN_STATUSES]).toEqual([
      "succeeded",
      "budget_exceeded",
      "turns_exceeded",
      "invalid_output",
      "timeout",
      "misconfigured",
      "failed",
    ]);
  });
});
