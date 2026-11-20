/** The UTC day (`YYYY-MM-DD`), the same day the daemon uses for the budget. */
export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Throws a `RangeError` unless `day` is a real calendar day written as `YYYY-MM-DD`. */
export function assertUtcDay(day: string): void {
  const fail = () => new RangeError("Dia inválido: use o formato AAAA-MM-DD");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw fail();
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) throw fail();
  if (new Date(ms).toISOString().slice(0, 10) !== day) throw fail();
}
