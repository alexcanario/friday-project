export type EvalRun = {
  itemId: string;
  status: "done" | "failed";
  costUsd: number | null;
  rounds: number;
};

export type EvalSummary = {
  total: number;
  done: number;
  doneRate: number;
  avgCostUsd: number;
  avgRounds: number;
  unknownCost: number;
};

export function evalSummary(runs: readonly EvalRun[]): EvalSummary {
  const total = runs.length;
  const done = runs.filter((r) => r.status === "done").length;
  const costs = runs.flatMap((r) => (r.costUsd === null ? [] : [r.costUsd]));
  const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);
  return {
    total,
    done,
    doneRate: total === 0 ? 0 : done / total,
    avgCostUsd: costs.length === 0 ? 0 : sum(costs) / costs.length,
    avgRounds: total === 0 ? 0 : sum(runs.map((r) => r.rounds)) / total,
    unknownCost: total - costs.length,
  };
}
