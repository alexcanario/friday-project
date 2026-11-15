import { readFileSync } from "node:fs";
import {
  experimentRunsSchema,
  summarizeByVariant,
  type ExperimentKind,
  type VariantSummary,
} from "@friday/application";

export type Result = { stdout: string; stderr: string; code: 0 | 1 | 2 };

const VARIANTS_USAGE =
  "Uso: friday eval --compare variants --input <arquivo> [--kind backend|frontend|cross]\n";
const KINDS: readonly string[] = ["backend", "frontend", "cross"];

export const fail = (reason: string): Result => ({ stdout: "", stderr: `${reason}\n`, code: 2 });
export const pct = (rate: number): string => `${Math.round(rate * 100)}%`;

export function readJson(
  file: string,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, "utf8")) };
  } catch {
    return { ok: false, reason: `Erro: não foi possível ler o JSON de ${file}` };
  }
}

export const variantsUsage = (): Result => ({ stdout: "", stderr: VARIANTS_USAGE, code: 2 });

function formatLine(s: VariantSummary): string {
  const context =
    s.avgPeakContextTokens === null ? "?" : String(Math.round(s.avgPeakContextTokens));
  return [
    `${s.variant}: Done ${pct(s.doneRate)}`,
    `Judge na 1ª rodada ${pct(s.judgeFirstRoundRate)}`,
    `Rodadas ${s.avgRounds.toFixed(2)}`,
    `Custo ${s.avgCostUsd.toFixed(2)} USD`,
    `Tempo ${Math.round(s.avgDurationS)} s`,
    `Contexto ${context} tokens`,
  ].join(" | ");
}

export function compareVariants(values: ReadonlyMap<string, string>): Result {
  const compare = values.get("--compare");
  if (compare !== "variants") return fail(`Erro: valor inválido para --compare: ${compare ?? ""}`);
  if (values.has("--baseline")) return fail("Erro: --baseline não se aplica a --compare variants");
  const kind = values.get("--kind");
  if (kind !== undefined && !KINDS.includes(kind))
    return fail(`Erro: valor inválido para --kind: ${kind}`);
  const input = values.get("--input");
  if (input === undefined) return variantsUsage();
  const raw = readJson(input);
  if (!raw.ok) return fail(raw.reason);
  const runs = experimentRunsSchema.safeParse(raw.value);
  if (!runs.success) return fail(`Erro: arquivo de entrada inválido: ${input}`);
  const summaries = summarizeByVariant(runs.data, kind as ExperimentKind | undefined);
  const lines = summaries.map(formatLine);
  return { stdout: lines.length === 0 ? "" : lines.join("\n") + "\n", stderr: "", code: 0 };
}
