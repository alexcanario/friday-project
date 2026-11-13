import { readFileSync } from "node:fs";
import {
  compareToBaseline,
  evalBaselineSchema,
  evalRunsSchema,
  evalSummary,
} from "@friday/application";

const USAGE = "Uso: friday eval --input <arquivo> --baseline <arquivo>\n";

type Result = { stdout: string; stderr: string; code: 0 | 1 | 2 };

const fail = (reason: string): Result => ({ stdout: "", stderr: `${reason}\n`, code: 2 });
const pct = (rate: number): string => `${Math.round(rate * 100)}%`;

function parseFlags(args: string[]): { input: string; baseline: string } | null {
  const values = new Map<string, string>();
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (key === undefined || value === undefined || value === "") return null;
    values.set(key, value);
  }
  const input = values.get("--input");
  const baseline = values.get("--baseline");
  return input === undefined || baseline === undefined ? null : { input, baseline };
}

function readJson(file: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, "utf8")) };
  } catch {
    return { ok: false, reason: `Erro: não foi possível ler o JSON de ${file}` };
  }
}

export function evalCommand(args: string[]): Result {
  const flags = parseFlags(args);
  if (flags === null) return { stdout: "", stderr: USAGE, code: 2 };
  const rawRuns = readJson(flags.input);
  if (!rawRuns.ok) return fail(rawRuns.reason);
  const rawBaseline = readJson(flags.baseline);
  if (!rawBaseline.ok) return fail(rawBaseline.reason);
  const runs = evalRunsSchema.safeParse(rawRuns.value);
  if (!runs.success) return fail(`Erro: arquivo de entrada inválido: ${flags.input}`);
  const baseline = evalBaselineSchema.safeParse(rawBaseline.value);
  if (!baseline.success) return fail(`Erro: arquivo de linha de base inválido: ${flags.baseline}`);
  const summary = evalSummary(runs.data);
  const cmp = compareToBaseline(summary, baseline.data, 0);
  const lines = [
    `Execuções: ${summary.total}`,
    `Taxa de Done: ${pct(summary.doneRate)}`,
    `Custo médio: ${summary.avgCostUsd.toFixed(2)} USD (${summary.unknownCost} sem custo)`,
    `Rodadas médias: ${summary.avgRounds.toFixed(2)}`,
  ];
  if (cmp.regressed) {
    lines.push(
      `Regressão: taxa de Done caiu de ${pct(cmp.baselineDoneRate)} para ${pct(cmp.currentDoneRate)}`,
    );
  }
  return { stdout: lines.join("\n") + "\n", stderr: "", code: cmp.regressed ? 1 : 0 };
}
