import { FakeAgentRuntime, type IssueRow, type LedgerEntry } from "@friday/application";
import type { AgentRuntime, LedgerRepository } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRunRecorder } from "../src/index.ts";
import { runQaForIssue, type QaDispatchDeps } from "../src/qa-dispatch.ts";
import {
  FakeEvents,
  FakeIssueRepository,
  FakeRunRepository,
  fakeRequest,
  slackBudget,
} from "./fakes.ts";

const now = () => new Date("2026-11-05T03:00:00.000Z");
const NOT = { applied: false, feedback: null };
const passed: RunFinished = {
  status: "succeeded",
  subtype: null,
  model: null,
  costUsd: 0.12,
  tokens: null,
  numTurns: null,
  durationMs: null,
  output: {
    verdict: "pass",
    criteria: [{ index: 1, result: "pass", how: "ok", screenshots: [] }],
    notChecked: [],
  },
  violations: [],
};

class MemoryLedger implements LedgerRepository {
  readonly entries: LedgerEntry[] = [];
  constructor(private readonly recordThrows = false) {}
  record(entry: LedgerEntry): void {
    if (this.recordThrows) throw new Error("ledger down");
    this.entries.push(entry);
  }
  sumByDay() {
    return { costUsd: 0, anyCostUnknown: false };
  }
  sumByIssue() {
    return { costUsd: 0, anyCostUnknown: false };
  }
}

function setup(o: { throws: boolean; ledgerThrows?: boolean }) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events, undefined, { projectFromEvents: true });
  const row: IssueRow = {
    projectId: "p",
    issueId: 7,
    state: "QA",
    heldReason: null,
    verifyRound: 0,
    qaRound: 0,
    reviewIter: 0,
  };
  issues.rows.set(7, row);
  const runs = new FakeRunRepository();
  const runtime: AgentRuntime = o.throws
    ? { run: () => Promise.reject(new Error("boom")) }
    : new FakeAgentRuntime([passed]);
  const ledger = new MemoryLedger(o.ledgerThrows);
  const recorderDeps = { projectId: "p", events, issues, now, ledger };
  const log = vi.fn<(m: string) => void>();
  const deps: QaDispatchDeps = {
    projectId: "p",
    targetOf: () => ({
      request: { ...fakeRequest(7), agent: { ...fakeRequest(7).agent, maxBudgetUsd: 1 } },
      headSha: "a".repeat(40),
      criteria: [
        { index: 1, claim: "x", proof: { kind: "command" as const, command: "pnpm test" } },
      ],
      changedFiles: [],
      screenPaths: [],
    }),
    step: { runtime, worktrees: { isClean: async () => true } },
    recorder: recorderDeps,
    recording: { runs, recorder: createRunRecorder(recorderDeps), newRunId: () => "r1" },
    ...slackBudget(recorderDeps),
    now,
    log,
  };
  return { deps, runs, ledger, log };
}

describe("runQaForIssue when the runtime throws", () => {
  it("records the run ceiling as unknown cost when the QA runtime throws", async () => {
    const t = setup({ throws: true });
    await expect(runQaForIssue(t.deps, 7)).resolves.toEqual(NOT);
    expect(t.ledger.entries).toHaveLength(1);
    expect(t.ledger.entries[0]).toMatchObject({
      runId: "r1",
      issueId: 7,
      costUsd: 1,
      costUnknown: true,
    });
  });

  it("records the real cost once when the QA runtime answers", async () => {
    const t = setup({ throws: false });
    await runQaForIssue(t.deps, 7);
    expect(t.ledger.entries).toHaveLength(1);
    expect(t.ledger.entries[0]).toMatchObject({ costUsd: 0.12, costUnknown: false });
  });

  it("only logs when the ledger also fails after a QA runtime throw", async () => {
    const t = setup({ throws: true, ledgerThrows: true });
    await expect(runQaForIssue(t.deps, 7)).resolves.toEqual(NOT);
    const logged = t.log.mock.calls.map((c) => c[0]).join("\n");
    expect(logged).toContain("Falha ao registrar o custo da run r1");
  });

  it("closes the QA run row as failed when the runtime throws", async () => {
    const t = setup({ throws: true });
    await runQaForIssue(t.deps, 7);
    expect(t.runs.rows.get("r1")?.status).toBe("failed");
  });
});
