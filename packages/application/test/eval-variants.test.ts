import { describe, expect, it } from "vitest";
import { summarizeByVariant, type ExperimentRun } from "../src/index.ts";

const run = (
  variant: string,
  kind: ExperimentRun["kind"],
  status: ExperimentRun["status"],
  costUsd: number | null,
  rounds: number,
  judgeFirstRound: boolean,
  durationS: number,
  peakContextTokens: number | null,
): ExperimentRun => ({
  itemId: "E1",
  kind,
  variant,
  status,
  costUsd,
  rounds,
  judgeFirstRound,
  durationS,
  peakContextTokens,
});

const runs: ExperimentRun[] = [
  run("generic", "backend", "done", 1, 1, true, 100, 10000),
  run("generic", "backend", "done", 2, 1, true, 200, 30000),
  run("generic", "backend", "done", 3, 2, false, 300, 50000),
  run("generic", "cross", "failed", 4, 4, false, 400, 70000),
  run("specialists", "backend", "done", null, 0, true, 100, null),
  run("specialists", "cross", "failed", 2, 3, false, 300, 20000),
];

describe("summarizeByVariant", () => {
  it("summarizes each variant with judge first-round rate, duration and peak context", () => {
    expect(summarizeByVariant(runs)).toEqual([
      {
        variant: "generic",
        total: 4,
        done: 3,
        doneRate: 0.75,
        avgCostUsd: 2.5,
        avgRounds: 2,
        unknownCost: 0,
        judgeFirstRoundRate: 0.5,
        avgDurationS: 250,
        avgPeakContextTokens: 40000,
        unknownContext: 0,
      },
      {
        variant: "specialists",
        total: 2,
        done: 1,
        doneRate: 0.5,
        avgCostUsd: 2,
        avgRounds: 1.5,
        unknownCost: 1,
        judgeFirstRoundRate: 0.5,
        avgDurationS: 200,
        avgPeakContextTokens: 20000,
        unknownContext: 1,
      },
    ]);
  });

  it("returns empty for no runs, filters by kind, orders variants alphabetically and keeps null context", () => {
    expect(summarizeByVariant([])).toEqual([]);
    expect(summarizeByVariant(runs, "cross")).toEqual([
      expect.objectContaining({
        variant: "generic",
        total: 1,
        doneRate: 0,
        avgCostUsd: 4,
        avgRounds: 4,
        judgeFirstRoundRate: 0,
        avgDurationS: 400,
        avgPeakContextTokens: 70000,
        unknownContext: 0,
      }),
      expect.objectContaining({
        variant: "specialists",
        total: 1,
        avgCostUsd: 2,
        avgRounds: 3,
        avgDurationS: 300,
        avgPeakContextTokens: 20000,
        unknownContext: 0,
      }),
    ]);
    const backend = summarizeByVariant(runs, "backend");
    expect(backend[1]).toEqual(
      expect.objectContaining({
        variant: "specialists",
        total: 1,
        done: 1,
        avgCostUsd: 0,
        unknownCost: 1,
        avgPeakContextTokens: null,
        unknownContext: 1,
      }),
    );
    expect(backend[0]).toEqual(
      expect.objectContaining({ variant: "generic", total: 3, avgPeakContextTokens: 30000 }),
    );
    expect(summarizeByVariant(runs, "frontend")).toEqual([]);
    const middle = [...runs, run("generic-context", "backend", "done", 1, 1, true, 10, 5)];
    expect(summarizeByVariant(middle).map((s) => s.variant)).toEqual([
      "generic",
      "generic-context",
      "specialists",
    ]);
  });
});
