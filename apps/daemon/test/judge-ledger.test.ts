import type { RunFinished } from "@friday/contracts";
import type { LedgerEntry, LedgerRepository } from "@friday/application";
import { describe, expect, it } from "vitest";
import { createRunRecorder, runJudgeForIssue } from "../src/index.ts";
import { finished, setup, verdict } from "./judge-dispatch-helpers.ts";

class RecordingLedger implements LedgerRepository {
  readonly entries: LedgerEntry[] = [];
  record(entry: LedgerEntry): void {
    this.entries.push(entry);
  }
  sumByDay() {
    return { costUsd: 0, anyCostUnknown: false };
  }
  sumByIssue() {
    return { costUsd: 0, anyCostUnknown: false };
  }
}

async function runWith(status: RunFinished["status"], costUsd: number | null) {
  const output = status === "succeeded" ? verdict() : null;
  const t = setup({ results: [{ ...finished(output, status), costUsd }] });
  const ledger = new RecordingLedger();
  const deps = {
    ...t.deps,
    recording: {
      ...t.deps.recording!,
      recorder: createRunRecorder({ ...t.deps.recorder, ledger }),
    },
  };
  await runJudgeForIssue(deps, 7);
  return { t, entries: ledger.entries };
}

describe("judge ledger", () => {
  it("records the judge run ceiling as cost_unknown and the real cost otherwise", async () => {
    const unknown = (await runWith("succeeded", null)).entries;
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({ costUsd: 1, costUnknown: true });
    const known = (await runWith("succeeded", 0.12)).entries;
    expect(known).toHaveLength(1);
    expect(known[0]).toMatchObject({ costUsd: 0.12, costUnknown: false });
  });

  it("records invalid_output judge run at the ceiling as cost_unknown", async () => {
    const { entries } = await runWith("invalid_output", null);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ costUsd: 1, costUnknown: true });
  });

  it("records invalid_output judge run with the real cost", async () => {
    const { entries } = await runWith("invalid_output", 0.12);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ costUsd: 0.12, costUnknown: false });
  });

  it("keeps InReview and event order on invalid_output with a ledger", async () => {
    const { t } = await runWith("invalid_output", null);
    expect(t.issues.row?.state).toBe("InReview");
    expect(t.issues.row?.heldReason).toBeNull();
    expect(t.ofType("StateChanged")).toEqual([]);
    expect(t.types()).toEqual(["RunFinished", "JudgeSkipped"]);
  });

  it("still records and holds on budget_exceeded and records on succeeded", async () => {
    const over = await runWith("budget_exceeded", null);
    expect(over.entries).toHaveLength(1);
    expect(over.t.issues.row?.state).toBe("Held");
    expect(over.t.issues.row?.heldReason).toBe("BudgetExceeded");
    expect((await runWith("succeeded", 0.5)).entries).toHaveLength(1);
  });
});
