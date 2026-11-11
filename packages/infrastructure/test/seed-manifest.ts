export type SeedCheck = { ok: true; count: number } | { ok: false; problems: string[] };

const filled = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function itemProblems(item: unknown, index: number, seen: Set<string>): string[] {
  const at = `item ${index + 1}`;
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return [`${at}: deve ser um objeto`];
  }
  const o = item as Record<string, unknown>;
  const problems: string[] = [];
  if (!filled(o.id) || !/^S\d+$/.test(o.id)) problems.push(`${at}: id inválido`);
  else if (seen.has(o.id)) problems.push(`${at}: id duplicado ${o.id}`);
  else seen.add(o.id);
  if (!filled(o.title)) problems.push(`${at}: title vazio`);
  if (!filled(o.body)) problems.push(`${at}: body vazio`);
  if (!Array.isArray(o.criteria) || o.criteria.length === 0 || !o.criteria.every(filled)) {
    problems.push(`${at}: criteria deve ter ao menos 1 texto não vazio`);
  }
  const d = o.plantedDefect;
  if (d !== null) {
    const ok =
      typeof d === "object" &&
      d !== null &&
      filled((d as Record<string, unknown>).kind) &&
      filled((d as Record<string, unknown>).description);
    if (!ok) problems.push(`${at}: plantedDefect inválido`);
  }
  return problems;
}

export function checkSeedManifest(value: unknown): SeedCheck {
  if (!Array.isArray(value)) return { ok: false, problems: ["o manifesto deve ser uma lista"] };
  const problems: string[] = [];
  if (value.length < 15 || value.length > 20) {
    problems.push(`a lista deve ter de 15 a 20 itens, tem ${value.length}`);
  }
  const seen = new Set<string>();
  value.forEach((item, i) => problems.push(...itemProblems(item, i, seen)));
  return problems.length === 0 ? { ok: true, count: value.length } : { ok: false, problems };
}
