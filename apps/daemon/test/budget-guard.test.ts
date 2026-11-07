import { describe, expect, it } from "vitest";
import { checkBudget } from "../src/index.ts";

const sum = (costUsd: number, anyCostUnknown = false) => ({ costUsd, anyCostUnknown });

describe("checkBudget", () => {
  it("reserves twice the run ceiling", () => {
    const caps = { perDayUsd: 0.05, perIssueUsd: 5, issue: sum(0) };
    expect(checkBudget({ ...caps, day: sum(0.04), runCeilingUsd: 0.01 })).toBe("BudgetExhausted");
    expect(checkBudget({ ...caps, day: sum(0.04), runCeilingUsd: 0.005 })).toBeNull();
    expect(checkBudget({ ...caps, day: sum(0.04, true), runCeilingUsd: 0.01 })).toBe(
      "BudgetExhausted",
    );
    expect(checkBudget({ ...caps, day: sum(0.04, true), runCeilingUsd: 0.005 })).toBeNull();
    expect(
      checkBudget({
        day: sum(0),
        issue: sum(0),
        runCeilingUsd: 0.01,
        perDayUsd: 10,
        perIssueUsd: 5,
      }),
    ).toBeNull();
  });

  it("prefers BudgetExhausted and accepts equality", () => {
    expect(
      checkBudget({
        day: sum(0),
        issue: sum(0.04),
        runCeilingUsd: 0.01,
        perDayUsd: 10,
        perIssueUsd: 0.05,
      }),
    ).toBe("IssueBudgetExceeded");
    expect(
      checkBudget({
        day: sum(0.04),
        issue: sum(0.04),
        runCeilingUsd: 0.01,
        perDayUsd: 0.05,
        perIssueUsd: 0.05,
      }),
    ).toBe("BudgetExhausted");
    expect(
      checkBudget({
        day: sum(0.03),
        issue: sum(0.03),
        runCeilingUsd: 0.01,
        perDayUsd: 0.05,
        perIssueUsd: 0.05,
      }),
    ).toBeNull();
  });
});
