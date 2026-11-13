import { describe, expect, it } from "vitest";
import { compareToBaseline, type EvalSummary } from "../src/index.ts";

const summary = (doneRate: number): EvalSummary => ({
  total: 10,
  done: 0,
  doneRate,
  avgCostUsd: 0,
  avgRounds: 0,
  unknownCost: 0,
});
const baseline = { doneRate: 0.75 };

describe("compareToBaseline", () => {
  it("flags only a drop of the done rate beyond the tolerance", () => {
    expect(compareToBaseline(summary(0.75), baseline, 0).regressed).toBe(false);
    expect(compareToBaseline(summary(0.7), baseline, 0).regressed).toBe(true);
    expect(compareToBaseline(summary(0.8), baseline, 0).regressed).toBe(false);
    expect(compareToBaseline(summary(0.7), baseline, 0.1).regressed).toBe(false);
    expect(compareToBaseline(summary(0.6), baseline, 0.1).regressed).toBe(true);
    expect(compareToBaseline(summary(0.6), baseline, 0)).toEqual({
      regressed: true,
      baselineDoneRate: 0.75,
      currentDoneRate: 0.6,
    });
  });
});
