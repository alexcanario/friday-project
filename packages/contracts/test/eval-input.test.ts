import { describe, expect, it } from "vitest";
import { evalBaselineSchema, evalRunsSchema } from "../src/index.ts";

const ok = { itemId: "a", status: "done", costUsd: 1, rounds: 1 };

describe("eval input schemas", () => {
  it("accepts valid runs and baseline and rejects invalid ones", () => {
    expect(evalRunsSchema.safeParse([ok, { ...ok, status: "failed", costUsd: null }]).success).toBe(
      true,
    );
    expect(evalRunsSchema.safeParse([{ ...ok, status: "merged" }]).success).toBe(false);
    const noRounds: Record<string, unknown> = { ...ok };
    delete noRounds.rounds;
    expect(evalRunsSchema.safeParse([noRounds]).success).toBe(false);
    expect(evalRunsSchema.safeParse([{ ...ok, costUsd: "1" }]).success).toBe(false);
    expect(evalBaselineSchema.safeParse({ doneRate: 0.75 }).success).toBe(true);
    expect(evalBaselineSchema.safeParse({ doneRate: 1.5 }).success).toBe(false);
  });

  it("rejects fractional rounds", () => {
    expect(evalRunsSchema.safeParse([{ ...ok, rounds: 1.5 }]).success).toBe(false);
  });

  it("rejects negative rounds", () => {
    expect(evalRunsSchema.safeParse([{ ...ok, rounds: -1 }]).success).toBe(false);
  });

  it("accepts rounds 0 and 3", () => {
    expect(evalRunsSchema.safeParse([{ ...ok, rounds: 0 }]).success).toBe(true);
    expect(evalRunsSchema.safeParse([{ ...ok, rounds: 3 }]).success).toBe(true);
  });

  it("rejects negative costUsd", () => {
    expect(evalRunsSchema.safeParse([{ ...ok, costUsd: -0.01 }]).success).toBe(false);
  });

  it("accepts costUsd 0, 2.5 and null", () => {
    expect(evalRunsSchema.safeParse([{ ...ok, costUsd: 0 }]).success).toBe(true);
    expect(evalRunsSchema.safeParse([{ ...ok, costUsd: 2.5 }]).success).toBe(true);
    expect(evalRunsSchema.safeParse([{ ...ok, costUsd: null }]).success).toBe(true);
  });
});
