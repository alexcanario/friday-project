import { FakeAgentRuntime, type DaySum, type IssueRow } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRunRecorder } from "../src/index.ts";
import { runQaForIssue, type QaDispatchDeps } from "../src/qa-dispatch.ts";
import { FakeEvents, FakeIssueRepository, FakeRunRepository, fakeRequest } from "./fakes.ts";

const now = () => new Date("2026-11-05T03:00:00.000Z");
const NOT = { applied: false, feedback: null };
const finished: RunFinished = {
  status: "succeeded",
  subtype: null,
  model: null,
  costUsd: null,
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

function setup(o: { perIssueUsd: number; perDayUsd?: number; ledgerThrows?: boolean }) {
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
  const runtime = new FakeAgentRuntime([finished]);
  const run = vi.spyOn(runtime, "run");
  const sum: DaySum = { costUsd: 0, anyCostUnknown: false };
  const ledger = {
    record: () => undefined,
    sumByDay: () => sum,
    sumByIssue: () => {
      if (o.ledgerThrows) throw new Error("ledger");
      return sum;
    },
  };
  const recorderDeps = { projectId: "p", events, issues, now };
  const log = vi.fn<(m: string) => void>();
  const deps: QaDispatchDeps = {
    projectId: "p",
    targetOf: () => ({
      request: fakeRequest(7),
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
    budget: { ledger, recorderDeps },
    caps: { perIssueUsd: o.perIssueUsd, perDayUsd: o.perDayUsd ?? 10 },
    now,
    log,
  };
  return { deps, run, runs, log };
}

describe("runQaForIssue budget", () => {
  it("holds QA above the cap and runs it below", async () => {
    const over = setup({ perIssueUsd: 1 });
    await expect(runQaForIssue(over.deps, 7)).resolves.toEqual(NOT);
    expect(over.run).not.toHaveBeenCalled();
    expect(over.runs.rows.size).toBe(0);
    const under = setup({ perIssueUsd: 5, perDayUsd: 10 });
    await runQaForIssue(under.deps, 7);
    expect(under.run).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the ledger cannot be read", async () => {
    const t = setup({ perIssueUsd: 5, ledgerThrows: true });
    await expect(runQaForIssue(t.deps, 7)).resolves.toEqual(NOT);
    expect(t.run).not.toHaveBeenCalled();
    expect(t.log).toHaveBeenCalledTimes(1);
  });
});
