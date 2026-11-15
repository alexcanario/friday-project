import { experimentRunSchema, type ExperimentKind, type ExperimentRun } from "@friday/contracts";

export const EXPERIMENT_ROUND_CAP_USD = 25;
export const EXPERIMENT_RUN_CAP_USD = 2;

export type ExperimentItem = { id: string; kind: ExperimentKind };
export type VariantOutcome = Omit<ExperimentRun, "itemId" | "kind" | "variant">;
export type VariantRunRequest = {
  item: ExperimentItem;
  variant: string;
  repetition: number;
  roles: readonly string[];
  maxBudgetUsd: number;
};

export interface VariantRunner {
  run(request: VariantRunRequest): Promise<VariantOutcome>;
}

export type PlannedRun = { itemId: string; variant: string; repetition: number };

export function rolesFor(variant: string, kind: ExperimentKind): string[] | null {
  if (variant === "generic" || variant === "generic-context") return ["generic"];
  if (variant !== "specialists") return null;
  return kind === "cross" ? ["backend", "frontend"] : [kind];
}

export function planExperiment(
  items: readonly ExperimentItem[],
  variants: readonly string[],
  repetitions: number,
): PlannedRun[] {
  const n = variants.length;
  const plan: PlannedRun[] = [];
  items.forEach((item, i) => {
    for (let repetition = 1; repetition <= repetitions; repetition++) {
      for (let k = 0; k < n; k++) {
        const variant = variants[(k + i + repetition - 1) % n];
        if (variant !== undefined) plan.push({ itemId: item.id, variant, repetition });
      }
    }
  });
  return plan;
}

function assertKnownVariants(items: readonly ExperimentItem[], variants: readonly string[]): void {
  const kinds = new Set(items.map((item) => item.kind));
  for (const variant of variants) {
    for (const kind of kinds) {
      if (rolesFor(variant, kind) === null) {
        throw new Error(`Erro: variante desconhecida: ${variant}`);
      }
    }
  }
}

const failedRun = (item: ExperimentItem, variant: string): ExperimentRun => ({
  itemId: item.id,
  kind: item.kind,
  variant,
  status: "failed",
  costUsd: null,
  rounds: 0,
  judgeFirstRound: false,
  durationS: 0,
  peakContextTokens: null,
});

async function executeOne(
  runner: VariantRunner,
  request: VariantRunRequest,
): Promise<ExperimentRun> {
  const { item, variant } = request;
  try {
    const outcome = await runner.run(request);
    const parsed = experimentRunSchema.safeParse({
      ...outcome,
      itemId: item.id,
      kind: item.kind,
      variant,
    });
    return parsed.success ? parsed.data : failedRun(item, variant);
  } catch {
    return failedRun(item, variant);
  }
}

export async function runExperiment(
  deps: { runner: VariantRunner; onRun: (run: ExperimentRun) => void },
  input: { items: readonly ExperimentItem[]; variants: readonly string[]; repetitions: number },
): Promise<{ runs: ExperimentRun[]; spentUsd: number; stoppedByCap: boolean }> {
  assertKnownVariants(input.items, input.variants);
  const itemById = new Map(input.items.map((item) => [item.id, item]));
  const plan = planExperiment(input.items, input.variants, input.repetitions);
  const runs: ExperimentRun[] = [];
  let spentUsd = 0;
  for (const planned of plan) {
    if (spentUsd >= EXPERIMENT_ROUND_CAP_USD) return { runs, spentUsd, stoppedByCap: true };
    const item = itemById.get(planned.itemId);
    const roles = item === undefined ? null : rolesFor(planned.variant, item.kind);
    if (item === undefined || roles === null) continue;
    const run = await executeOne(deps.runner, {
      item,
      variant: planned.variant,
      repetition: planned.repetition,
      roles,
      maxBudgetUsd: EXPERIMENT_RUN_CAP_USD,
    });
    spentUsd += run.costUsd ?? EXPERIMENT_RUN_CAP_USD;
    runs.push(run);
    deps.onRun(run);
  }
  return { runs, spentUsd, stoppedByCap: false };
}
