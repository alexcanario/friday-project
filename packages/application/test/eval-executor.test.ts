import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPERIMENT_ROUND_CAP_USD,
  EXPERIMENT_RUN_CAP_USD,
  experimentRunsSchema,
  planExperiment,
  rolesFor,
  runExperiment,
  summarizeByVariant,
  type ExperimentItem,
  type ExperimentRun,
  type VariantOutcome,
  type VariantRunRequest,
  type VariantRunner,
} from "../src/index.ts";

const VARIANTS = ["generic", "generic-context", "specialists"];
const ITEMS: ExperimentItem[] = [
  ...["E1", "E2", "E3"].map((id) => ({ id, kind: "backend" as const })),
  ...["E4", "E5", "E6"].map((id) => ({ id, kind: "frontend" as const })),
  ...["E7", "E8", "E9"].map((id) => ({ id, kind: "cross" as const })),
];

const outcome = (costUsd: number | null): VariantOutcome => ({
  status: "done",
  costUsd,
  rounds: 1,
  judgeFirstRound: true,
  durationS: 10,
  peakContextTokens: 1000,
});

function fakeRunner(
  answer: (request: VariantRunRequest, call: number) => VariantOutcome | Promise<VariantOutcome>,
): VariantRunner & { calls: VariantRunRequest[] } {
  const calls: VariantRunRequest[] = [];
  return {
    calls,
    run: async (request) => {
      calls.push(request);
      return answer(request, calls.length);
    },
  };
}

const collect = (): { runs: ExperimentRun[]; onRun: (run: ExperimentRun) => void } => {
  const runs: ExperimentRun[] = [];
  return { runs, onRun: (run) => void runs.push(run) };
};

const input = { items: ITEMS, variants: VARIANTS, repetitions: 2 };

describe("rolesFor", () => {
  it("maps each variant and kind to the roles of the registry", () => {
    expect(rolesFor("generic", "cross")).toEqual(["generic"]);
    expect(rolesFor("generic-context", "backend")).toEqual(["generic"]);
    expect(rolesFor("specialists", "backend")).toEqual(["backend"]);
    expect(rolesFor("specialists", "frontend")).toEqual(["frontend"]);
    expect(rolesFor("specialists", "cross")).toEqual(["backend", "frontend"]);
    expect(rolesFor("outra", "backend")).toBeNull();
    const agents = readdirSync(resolve(import.meta.dirname, "../../../registry/agents"));
    for (const variant of VARIANTS) {
      for (const kind of ["backend", "frontend", "cross"] as const) {
        for (const role of rolesFor(variant, kind) ?? []) {
          expect(agents).toContain(`${role}.yaml`);
        }
      }
    }
  });
});

describe("planExperiment", () => {
  it("plans the runs rotating the variants in each issue", () => {
    const plan = planExperiment(
      [
        { id: "E1", kind: "backend" },
        { id: "E2", kind: "backend" },
      ],
      ["a", "b", "c"],
      2,
    );
    const label = (itemId: string, repetition: number): string =>
      plan
        .filter((p) => p.itemId === itemId && p.repetition === repetition)
        .map((p) => p.variant)
        .join(" ");
    expect(plan).toHaveLength(12);
    expect(plan.map((p) => `${p.itemId}/${p.repetition}:${p.variant}`).slice(0, 6)).toEqual([
      "E1/1:a",
      "E1/1:b",
      "E1/1:c",
      "E1/2:b",
      "E1/2:c",
      "E1/2:a",
    ]);
    expect(label("E1", 1)).toBe("a b c");
    expect(label("E1", 2)).toBe("b c a");
    expect(label("E2", 1)).toBe("b c a");
    expect(label("E2", 2)).toBe("c a b");
    expect(plan.map((p) => p.itemId)).toEqual([
      "E1",
      "E1",
      "E1",
      "E1",
      "E1",
      "E1",
      "E2",
      "E2",
      "E2",
      "E2",
      "E2",
      "E2",
    ]);
    expect(planExperiment([], ["a", "b"], 2)).toEqual([]);
    expect(planExperiment([{ id: "E1", kind: "backend" }], ["a", "b"], 0)).toEqual([]);
  });
});

describe("runExperiment", () => {
  it("runs the whole plan with the run cap and valid runs", async () => {
    expect(EXPERIMENT_ROUND_CAP_USD).toBe(25);
    expect(EXPERIMENT_RUN_CAP_USD).toBe(2);
    const runner = fakeRunner(() => outcome(0.1));
    const sink = collect();
    const result = await runExperiment({ runner, onRun: sink.onRun }, input);
    expect(result.runs).toHaveLength(54);
    expect(sink.runs).toEqual(result.runs);
    expect(result.spentUsd).toBeCloseTo(5.4);
    expect(result.stoppedByCap).toBe(false);
    for (const call of runner.calls) {
      expect(call.maxBudgetUsd).toBe(2);
      expect(call.roles).toEqual(rolesFor(call.variant, call.item.kind));
    }
    expect(experimentRunsSchema.safeParse(result.runs).success).toBe(true);

    const rejected = fakeRunner(() => outcome(0.1));
    await expect(
      runExperiment(
        { runner: rejected, onRun: () => undefined },
        { ...input, variants: ["generic", "outra"] },
      ),
    ).rejects.toThrow("Erro: variante desconhecida: outra");
    expect(rejected.calls).toHaveLength(0);
  });

  it("stops when the round total reaches 25 USD and counts unknown cost as 2", async () => {
    const at = async (costUsd: number | null) => {
      const runner = fakeRunner(() => outcome(costUsd));
      const result = await runExperiment({ runner, onRun: () => undefined }, input);
      return { result, runner };
    };
    const five = await at(5);
    expect(five.result.runs).toHaveLength(5);
    expect(five.result.spentUsd).toBe(25);
    expect(five.result.stoppedByCap).toBe(true);
    expect(five.runner.calls).toHaveLength(5);

    const two = await at(2);
    expect(two.result.runs).toHaveLength(13);
    expect(two.result.spentUsd).toBe(26);
    expect(two.result.stoppedByCap).toBe(true);

    const unknown = await at(null);
    expect(unknown.result.runs).toHaveLength(13);
    expect(unknown.result.spentUsd).toBe(26);
    expect(unknown.result.stoppedByCap).toBe(true);
    expect(unknown.result.runs[0]?.costUsd).toBeNull();

    const exact = await runExperiment(
      { runner: fakeRunner(() => outcome(5)), onRun: () => undefined },
      { items: [{ id: "E1", kind: "backend" }], variants: ["generic"], repetitions: 5 },
    );
    expect(exact.runs).toHaveLength(5);
    expect(exact.spentUsd).toBe(25);
    expect(exact.stoppedByCap).toBe(false);
  });

  it("keeps the variants within one run of each other after a stop", async () => {
    const runner = fakeRunner(() => outcome(2));
    const result = await runExperiment({ runner, onRun: () => undefined }, input);
    const count = (variant: string): number =>
      result.runs.filter((r) => r.variant === variant).length;
    expect(result.runs).toHaveLength(13);
    expect(count("specialists")).toBe(5);
    expect(count("generic")).toBe(4);
    expect(count("generic-context")).toBe(4);
    expect(result.runs[12]).toMatchObject({ itemId: "E3", variant: "specialists" });
    expect(() => summarizeByVariant(result.runs)).not.toThrow();
  });

  it("records a failed run when the runner throws or returns an invalid outcome, and stops when onRun throws", async () => {
    const failed = {
      status: "failed",
      costUsd: null,
      rounds: 0,
      judgeFirstRound: false,
      durationS: 0,
      peakContextTokens: null,
    };
    const runner = fakeRunner((_request, call) => {
      if (call === 2) throw new Error("boom");
      return outcome(call === 3 ? -1 : 0.1);
    });
    const result = await runExperiment({ runner, onRun: () => undefined }, input);
    expect(result.runs).toHaveLength(54);
    const plan = planExperiment(ITEMS, VARIANTS, 2);
    for (const index of [1, 2]) {
      const planned = plan[index]!;
      expect(result.runs[index]).toEqual({
        ...failed,
        itemId: planned.itemId,
        kind: ITEMS.find((i) => i.id === planned.itemId)?.kind,
        variant: planned.variant,
      });
    }
    expect(result.spentUsd).toBeCloseTo(4 + 52 * 0.1);
    expect(result.stoppedByCap).toBe(false);

    const sink: ExperimentRun[] = [];
    const strict = fakeRunner(() => outcome(0.1));
    await expect(
      runExperiment(
        {
          runner: strict,
          onRun: (run) => {
            sink.push(run);
            if (sink.length === 4) throw new Error("disk full");
          },
        },
        input,
      ),
    ).rejects.toThrow("disk full");
    expect(strict.calls).toHaveLength(4);
  });
});
