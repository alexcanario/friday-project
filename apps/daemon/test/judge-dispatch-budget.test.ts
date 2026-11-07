import { describe, expect, it } from "vitest";
import { runJudgeForIssue } from "../src/index.ts";
import { agents, setup } from "./judge-dispatch-helpers.ts";

const NOT = { applied: false, feedback: null };
const zero = { costUsd: 0, anyCostUnknown: false };

function withCaps(
  t: ReturnType<typeof setup>,
  caps: { perIssueUsd: number; perDayUsd: number },
  throws = false,
) {
  t.deps.caps = caps;
  t.deps.budget = {
    ...t.deps.budget,
    ledger: {
      record: () => undefined,
      sumByDay: () => zero,
      sumByIssue: () => {
        if (throws) throw new Error("ledger");
        return zero;
      },
    },
  };
}

describe("runJudgeForIssue budget", () => {
  it("holds the Judge above the cap using the sum of both ceilings and runs it below", async () => {
    const over = setup({ agents: agents({ maxBudgetUsd: 0.1 }, { maxBudgetUsd: 1 }) });
    withCaps(over, { perIssueUsd: 2, perDayUsd: 10 });
    await expect(runJudgeForIssue(over.deps, 7)).resolves.toEqual(NOT);
    expect(over.runtime.requests).toHaveLength(0);
    expect(over.runs.rows.size).toBe(0);
    const under = setup();
    withCaps(under, { perIssueUsd: 5, perDayUsd: 10 });
    await runJudgeForIssue(under.deps, 7);
    expect(under.runtime.requests).toHaveLength(1);
  });

  it("fails closed when the ledger cannot be read", async () => {
    const t = setup();
    withCaps(t, { perIssueUsd: 5, perDayUsd: 10 }, true);
    await expect(runJudgeForIssue(t.deps, 7)).resolves.toEqual(NOT);
    expect(t.runtime.requests).toHaveLength(0);
    expect(t.log).toHaveBeenCalledTimes(1);
  });
});
