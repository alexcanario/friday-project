import type { ExperimentKind, ExperimentRun } from "@friday/contracts";
import { evalSummary, type EvalSummary } from "./eval-summary.ts";

export type VariantSummary = EvalSummary & {
  variant: string;
  judgeFirstRoundRate: number;
  avgDurationS: number;
  avgPeakContextTokens: number | null;
  unknownContext: number;
};

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

function summarize(variant: string, runs: readonly ExperimentRun[]): VariantSummary {
  const total = runs.length;
  const contexts = runs.flatMap((r) => (r.peakContextTokens === null ? [] : [r.peakContextTokens]));
  return {
    ...evalSummary(runs),
    variant,
    judgeFirstRoundRate: runs.filter((r) => r.judgeFirstRound).length / total,
    avgDurationS: sum(runs.map((r) => r.durationS)) / total,
    avgPeakContextTokens: contexts.length === 0 ? null : sum(contexts) / contexts.length,
    unknownContext: total - contexts.length,
  };
}

export function summarizeByVariant(
  runs: readonly ExperimentRun[],
  kind?: ExperimentKind,
): VariantSummary[] {
  const groups = new Map<string, ExperimentRun[]>();
  for (const run of runs) {
    if (kind !== undefined && run.kind !== kind) continue;
    const group = groups.get(run.variant);
    if (group === undefined) groups.set(run.variant, [run]);
    else group.push(run);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([variant, group]) => summarize(variant, group));
}
