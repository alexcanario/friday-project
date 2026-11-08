import type { LedgerEntry, LedgerRepository } from "@friday/application";
import { describe, expect, it } from "vitest";
import { createRunRecorder, runJudgeForIssue } from "../src/index.ts";
import { TOKEN, finished, noTokenLeak, logged, setup, verdict } from "./judge-dispatch-helpers.ts";

const NOT = { applied: false, feedback: null };

class MemoryLedger implements LedgerRepository {
  readonly entries: LedgerEntry[] = [];
  constructor(private readonly recordThrows = false) {}
  record(entry: LedgerEntry): void {
    if (this.recordThrows) throw new Error(`falhou ${TOKEN}`);
    this.entries.push(entry);
  }
  sumByDay() {
    return { costUsd: 0, anyCostUnknown: false };
  }
  sumByIssue() {
    return { costUsd: 0, anyCostUnknown: false };
  }
}

function build(o: { throws: boolean; ledgerThrows?: boolean }) {
  const output = { ...finished(verdict()), costUsd: 0.12 };
  const t = setup({ results: [output] });
  const ledger = new MemoryLedger(o.ledgerThrows);
  if (o.throws) t.deps.step.runtime = { run: () => Promise.reject(new Error("boom")) };
  const deps = {
    ...t.deps,
    recording: {
      ...t.deps.recording!,
      recorder: createRunRecorder({ ...t.deps.recorder, ledger }),
    },
  };
  return { t, deps, ledger };
}

describe("runJudgeForIssue when the runtime throws", () => {
  it("records the run ceiling as unknown cost when the Judge runtime throws", async () => {
    const { deps, ledger } = build({ throws: true });
    await expect(runJudgeForIssue(deps, 7)).resolves.toEqual(NOT);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({ costUsd: 1, costUnknown: true });
  });

  it("records the real cost once when the Judge runtime answers", async () => {
    const { deps, ledger } = build({ throws: false });
    await runJudgeForIssue(deps, 7);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({ costUsd: 0.12, costUnknown: false });
  });

  it("only logs when the ledger also fails after a Judge runtime throw", async () => {
    const { t, deps } = build({ throws: true, ledgerThrows: true });
    await expect(runJudgeForIssue(deps, 7)).resolves.toEqual(NOT);
    expect(logged(t)).toContain("Falha ao registrar o custo da run");
    noTokenLeak(t);
  });
});
