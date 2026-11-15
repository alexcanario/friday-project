import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  experimentIssuesSchema,
  experimentVariantsSchema,
  runExperiment,
  type VariantRunner,
} from "@friday/application";
import { createExperimentRunFile } from "@friday/infrastructure";
import type { ProductionInput } from "./eval-run-production.ts";
import { fail, readJson, type Result } from "./eval-variants.ts";

export type EvalRunDeps = {
  registryRoot: string;
  createRunner: (input: ProductionInput) => Promise<{ runner: VariantRunner; close(): void }>;
  env: Record<string, string | undefined>;
  homeDir: string;
  now: () => number;
};

const USAGE = "Uso: friday eval --run variants --output <arquivo> [--repetitions <n>]\n";
const RUN_FLAGS = new Set(["--run", "--output", "--repetitions"]);
const OTHER_EVAL_FLAGS = new Set(["--compare", "--input", "--baseline", "--kind"]);
const DEFAULT_REPETITIONS = 2;

type Parsed = { ok: true; output: string; repetitions: number } | { ok: false; result: Result };

const usage = (): Parsed => ({ ok: false, result: { stdout: "", stderr: USAGE, code: 2 } });
const refuse = (reason: string): Parsed => ({ ok: false, result: fail(reason) });

function parseRunFlags(args: string[]): Parsed {
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i];
    if (key !== undefined && !RUN_FLAGS.has(key) && !OTHER_EVAL_FLAGS.has(key))
      return refuse(`Erro: flag desconhecida: ${key}`);
  }
  const values = new Map<string, string>();
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (key === undefined || value === undefined || value === "") return usage();
    values.set(key, value);
  }
  const run = values.get("--run");
  if (run !== "variants") return refuse(`Erro: valor inválido para --run: ${run ?? ""}`);
  if ([...values.keys()].some((key) => OTHER_EVAL_FLAGS.has(key)))
    return refuse("Erro: --run só aceita --output e --repetitions");
  const output = values.get("--output");
  if (output === undefined) return usage();
  const raw = values.get("--repetitions");
  if (raw !== undefined && !/^[1-5]$/.test(raw))
    return refuse(`Erro: valor inválido para --repetitions: ${raw}`);
  return { ok: true, output, repetitions: raw === undefined ? DEFAULT_REPETITIONS : Number(raw) };
}

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };
type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

function readConfig<T>(file: string, schema: Schema<T>): Read<T> {
  const raw = readJson(file);
  if (!raw.ok) return raw;
  const parsed = schema.safeParse(raw.value);
  if (!parsed.success)
    return { ok: false, reason: `Erro: arquivo de configuração inválido: ${file}` };
  return { ok: true, value: parsed.data };
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type Plan = {
  variants: string[];
  items: { id: string; kind: "backend" | "frontend" | "cross" }[];
  criteriaById: ReadonlyMap<string, readonly string[]>;
};

function readPlan(registryRoot: string): Read<Plan> {
  const variants = readConfig(
    join(registryRoot, "eval", "variants.json"),
    experimentVariantsSchema,
  );
  if (!variants.ok) return variants;
  const issues = readConfig(
    join(registryRoot, "eval", "experiment-issues.json"),
    experimentIssuesSchema,
  );
  if (!issues.ok) return issues;
  return {
    ok: true,
    value: {
      variants: variants.value.map((variant) => variant.id),
      items: issues.value.map(({ id, kind }) => ({ id, kind })),
      criteriaById: new Map(issues.value.map((issue) => [issue.id, issue.criteria])),
    },
  };
}

function summary(result: { runs: unknown[]; spentUsd: number; stoppedByCap: boolean }): Result {
  const lines = [
    `Execuções: ${result.runs.length}`,
    `Custo total: ${result.spentUsd.toFixed(2)} USD`,
    `Parada pelo teto: ${result.stoppedByCap ? "sim" : "não"}`,
  ];
  return { stdout: lines.join("\n") + "\n", stderr: "", code: 0 };
}

export async function runEvalRun(args: string[], deps: EvalRunDeps): Promise<Result> {
  const flags = parseRunFlags(args);
  if (!flags.ok) return flags.result;
  if (existsSync(flags.output)) return fail(`Erro: o arquivo já existe: ${flags.output}`);
  const plan = readPlan(deps.registryRoot);
  if (!plan.ok) return fail(plan.reason);
  const { registryRoot, env, homeDir, now } = deps;
  let created: Awaited<ReturnType<EvalRunDeps["createRunner"]>>;
  try {
    created = await deps.createRunner({ registryRoot, env, homeDir, now, ...plan.value });
  } catch (error) {
    return fail(messageOf(error));
  }
  try {
    const file = createExperimentRunFile(flags.output);
    const { variants, items } = plan.value;
    const input = { items, variants, repetitions: flags.repetitions };
    return summary(await runExperiment({ runner: created.runner, onRun: file.append }, input));
  } catch (error) {
    return fail(messageOf(error));
  } finally {
    try {
      created.close();
    } catch {
      // A failure to close must not hide the result of a run that already spent money.
    }
  }
}
