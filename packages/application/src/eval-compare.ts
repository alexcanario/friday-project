import type { EvalSummary } from "./eval-summary.ts";

export type EvalBaseline = { doneRate: number };

export type EvalComparison = {
  regressed: boolean;
  baselineDoneRate: number;
  currentDoneRate: number;
};

export function compareToBaseline(
  summary: EvalSummary,
  baseline: EvalBaseline,
  tolerance: number,
): EvalComparison {
  return {
    regressed: summary.doneRate < baseline.doneRate - tolerance,
    baselineDoneRate: baseline.doneRate,
    currentDoneRate: summary.doneRate,
  };
}
