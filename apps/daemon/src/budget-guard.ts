import type { DaySum } from "@friday/application";

export type BudgetVerdict = "BudgetExhausted" | "IssueBudgetExceeded" | null;

export type BudgetCheck = {
  day: DaySum;
  issue: DaySum;
  runCeilingUsd: number;
  perDayUsd: number;
  perIssueUsd: number;
};

/** Reserves twice the run ceiling (a run can overshoot it, Q3 of #21); equality does not exceed. */
export function checkBudget(input: BudgetCheck): BudgetVerdict {
  const reserve = 2 * input.runCeilingUsd;
  if (input.day.costUsd + reserve > input.perDayUsd) return "BudgetExhausted";
  if (input.issue.costUsd + reserve > input.perIssueUsd) return "IssueBudgetExceeded";
  return null;
}
