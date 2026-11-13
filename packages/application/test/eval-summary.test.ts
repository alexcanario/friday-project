import { describe, expect, it } from "vitest";
import { evalSummary, type EvalRun } from "../src/index.ts";

const run = (status: EvalRun["status"], costUsd: number | null, rounds: number): EvalRun => ({
  itemId: "x",
  status,
  costUsd,
  rounds,
});

describe("evalSummary", () => {
  it("summarizes done rate, average cost and rounds", () => {
    const runs = [run("done", 1, 1), run("done", 2, 1), run("done", 3, 2), run("failed", 4, 4)];
    expect(evalSummary(runs)).toEqual({
      total: 4,
      done: 3,
      doneRate: 0.75,
      avgCostUsd: 2.5,
      avgRounds: 2,
      unknownCost: 0,
    });
  });

  it("returns zeros for an empty set and counts unknown costs", () => {
    expect(evalSummary([])).toEqual({
      total: 0,
      done: 0,
      doneRate: 0,
      avgCostUsd: 0,
      avgRounds: 0,
      unknownCost: 0,
    });
    const partial = evalSummary([run("done", 2, 1), run("done", null, 1)]);
    expect(partial.avgCostUsd).toBe(2);
    expect(partial.unknownCost).toBe(1);
  });
});
