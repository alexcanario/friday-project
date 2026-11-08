import type { IssueSummary } from "@friday/application";

type Capacity = { active: number; max: number };

/** Runs `triage` unless the issue is already running or the capacity is used up. */
export async function runGuardedTriage(
  triage: (issue: IssueSummary) => Promise<unknown>,
  running: Set<number>,
  usedSlots: number,
  capacity: Capacity | undefined,
  issue: IssueSummary,
  log: (message: string) => void,
): Promise<void> {
  if (running.has(issue.number)) return;
  if (capacity !== undefined && capacity.active + usedSlots >= capacity.max) return;
  running.add(issue.number);
  try {
    await triage(issue);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    log(`Falha ao rodar a triagem da issue ${issue.number}: ${text}`);
  } finally {
    running.delete(issue.number);
  }
}
