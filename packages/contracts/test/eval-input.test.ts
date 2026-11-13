import { describe, expect, it } from "vitest";
import { evalBaselineSchema, evalRunsSchema } from "../src/index.ts";

const ok = { itemId: "a", status: "done", costUsd: 1, rounds: 1 };

describe("eval input schemas", () => {
  it("accepts valid runs and baseline and rejects invalid ones", () => {
    expect(evalRunsSchema.safeParse([ok, { ...ok, status: "failed", costUsd: null }]).success).toBe(
      true,
    );
    expect(evalRunsSchema.safeParse([{ ...ok, status: "merged" }]).success).toBe(false);
    const { rounds: _rounds, ...noRounds } = ok;
    expect(evalRunsSchema.safeParse([noRounds]).success).toBe(false);
    expect(evalRunsSchema.safeParse([{ ...ok, costUsd: "1" }]).success).toBe(false);
    expect(evalBaselineSchema.safeParse({ doneRate: 0.75 }).success).toBe(true);
    expect(evalBaselineSchema.safeParse({ doneRate: 1.5 }).success).toBe(false);
  });
});
