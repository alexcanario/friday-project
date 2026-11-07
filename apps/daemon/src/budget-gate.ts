import type { LedgerRepository } from "@friday/application";
import { checkBudget } from "./budget-guard.ts";
import { applyInput, type RunRecorderDeps } from "./run-recorder.ts";

export type BudgetDeps = { ledger: LedgerRepository; recorderDeps: RunRecorderDeps };

export type BudgetCaps = { perDayUsd: number; perIssueUsd: number };

/**
 * Checks the issue and day caps before a run starts. Returns true when the run may start;
 * false when it was held (or the hold was not accepted, then `log` says so). Throws when the
 * request or the ledger cannot be read, so the caller fails closed.
 */
export function passesBudget(
  budget: BudgetDeps,
  caps: BudgetCaps,
  input: { projectId: string; issueId: number; runCeilingUsd: number; nowMs: number },
  log: (message: string) => void,
): boolean {
  const { projectId, issueId } = input;
  const day = new Date(input.nowMs).toISOString().slice(0, 10);
  const verdict = checkBudget({
    day: budget.ledger.sumByDay(projectId, day),
    issue: budget.ledger.sumByIssue(projectId, issueId),
    runCeilingUsd: input.runCeilingUsd,
    ...caps,
  });
  if (verdict === null) return true;
  const held = applyInput(
    budget.recorderDeps,
    { issueId, runId: null },
    { type: "RunHeld", reason: verdict },
  );
  if (!held) log(`Budget cap ${verdict} for issue ${issueId} but RunHeld was not accepted`);
  return false;
}
