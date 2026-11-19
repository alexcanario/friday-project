/** The UTC day (`YYYY-MM-DD`), the same day the daemon uses for the budget. */
export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}
