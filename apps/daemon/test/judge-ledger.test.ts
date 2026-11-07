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

async function runWith(costUsd: number | null) {
  const t = setup({ results: [{ ...finished(verdict()), costUsd }] });
  const ledger = new RecordingLedger();
  const deps = {
    ...t.deps,
    recording: {
      ...t.deps.recording!,
      recorder: createRunRecorder({ ...t.deps.recorder, ledger }),
    },
  };
  await runJudgeForIssue(deps, 7);
  return ledger.entries;
}

describe("judge ledger", () => {
  it("records the judge run ceiling as cost_unknown and the real cost otherwise", async () => {
    const unknown = await runWith(null);
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({ costUsd: 1, costUnknown: true });
    const known = await runWith(0.12);
    expect(known).toHaveLength(1);
    expect(known[0]).toMatchObject({ costUsd: 0.12, costUnknown: false });
  });
});
