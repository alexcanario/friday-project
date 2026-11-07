import { describe, expect, it, vi } from "vitest";
import {
  FakeAgentRuntime,
  type AgentRunRequest,
  type DaySum,
  type IssueRow,
  type LedgerRepository,
} from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import * as daemon from "../src/index.ts";
import {
  buildSpecialistRequest,
  createRunRecorder,
  runSpecialistForIssue,
  type SpecialistDispatchDeps,
} from "../src/index.ts";
import { FakeEvents, FakeIssueRepository, FakeRunRepository } from "./fakes.ts";

const now = () => new Date("2026-11-07T03:00:00.000Z");
const agent = {
  model: "sonnet",
  states: ["InProgress"],
  maxBudgetUsd: 1,
  maxTurns: 5,
  timeoutMs: 60000,
  tools: ["Read"],
  allowedTools: ["mcp__friday__work_report"],
  bashAllow: [],
  promptFile: "backend.md",
  outputKind: "workReport",
} as unknown as Parameters<typeof buildSpecialistRequest>[0]["agent"];
const report = {
  summary: "Adiciona GET /version",
  headSha: "a".repeat(40),
  changedFiles: ["src/Version.cs"],
  notDone: [],
};
const finished = (output: unknown): RunFinished => ({
  status: "succeeded",
  subtype: null,
  model: null,
  costUsd: null,
  tokens: null,
  numTurns: null,
  durationMs: null,
  output,
  violations: [],
});
const request = (runId: string): AgentRunRequest =>
  buildSpecialistRequest({
    issue: { number: 7, title: "Adiciona GET /version", body: "Corpo" },
    criteria: null,
    feedback: null,
    agent,
    friday: {
      runId,
      agent: { states: ["InProgress"], mcp_tools: ["work_report"] },
      getIssueState: () => "InProgress",
    },
    cwd: "/tmp/wt",
    configRoot: "/cfg",
    branch: "friday/7-version",
    base: "develop",
    getPullRequest: () => null,
  });

type Opts = {
  output?: unknown;
  noTarget?: boolean;
  noRow?: boolean;
  throws?: boolean;
  issueCost?: number;
  dayCost?: number;
  ledgerThrows?: boolean;
  recordLedger?: boolean;
  failOnWorkReported?: boolean;
};

function setup(o: Opts = {}) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events, undefined, { projectFromEvents: true });
  const row: IssueRow = {
    projectId: "p",
    issueId: 7,
    state: "InProgress",
    heldReason: null,
    verifyRound: 0,
    qaRound: 0,
    reviewIter: 0,
  };
  if (!o.noRow) issues.rows.set(7, row);
  const runs = new FakeRunRepository();
  const fake = new FakeAgentRuntime([finished(o.output ?? report)]);
  const run = vi.fn((r: AgentRunRequest) =>
    o.throws ? Promise.reject(new Error("boom")) : fake.run(r),
  );
  const sum = (costUsd: number): DaySum => ({ costUsd, anyCostUnknown: false });
  const entries: Parameters<LedgerRepository["record"]>[0][] = [];
  const ledger: LedgerRepository = {
    record: (entry) => void entries.push(entry),
    sumByDay: () => sum(o.dayCost ?? 0),
    sumByIssue: () => {
      if (o.ledgerThrows) throw new Error("ledger");
      return sum(o.issueCost ?? 0);
    },
  };
  const recorderDeps = {
    projectId: "p",
    events,
    issues,
    now,
    ...(o.recordLedger ? { ledger } : {}),
  };
  if (o.failOnWorkReported) {
    const append = events.append.bind(events);
    events.append = (e) => {
      if (e.type === "WorkReported") throw new Error("later step");
      return append(e);
    };
  }
  const recorder = createRunRecorder(recorderDeps);
  const recordUnknownCost = vi.spyOn(recorder, "recordUnknownCost");
  const log = vi.fn<(m: string) => void>();
  const targetOf = vi.fn((_id: number, runId: string) => (o.noTarget ? null : request(runId)));
  const deps: SpecialistDispatchDeps = {
    projectId: "p",
    targetOf,
    step: { runtime: { run } },
    recorder: recorderDeps,
    recording: { runs, recorder, newRunId: () => "run-1" },
    budget: { ledger, recorderDeps },
    caps: { perDayUsd: 100, perIssueUsd: 10 },
    now,
    log,
  };
  const ofType = (t: string) => events.appended.filter((e) => e.type === t);
  return { events, issues, runs, run, entries, deps, log, targetOf, recordUnknownCost, ofType };
}

const NOT = { applied: false, feedback: null };

describe("runSpecialistForIssue", () => {
  it("records WorkReported and moves to Verify on a valid report, holds on an invalid one", async () => {
    const t = setup();
    await runSpecialistForIssue(t.deps, 7);
    expect(t.issues.rows.get(7)?.state).toBe("Verify");
    expect(t.ofType("WorkReported")).toHaveLength(1);
    expect(t.ofType("WorkReported")[0]).toMatchObject({ runId: "run-1", actor: "daemon" });
    expect(t.ofType("WorkReported")[0]?.payload).toEqual({
      worktreePath: "/tmp/wt",
      headSha: "a".repeat(40),
      changedFiles: ["src/Version.cs"],
    });
    expect(t.runs.rows.get("run-1")).toMatchObject({ status: "succeeded" });
    expect(t.runs.rows.get("run-1")?.finishedAt).not.toBeNull();
    expect(t.ofType("RunFinished")).toHaveLength(1);

    const bad = setup({ output: { summary: "x" } });
    await runSpecialistForIssue(bad.deps, 7);
    expect(bad.issues.rows.get(7)).toMatchObject({ state: "Held", heldReason: "SchemaInvalid" });
    expect(bad.ofType("WorkReported")).toHaveLength(0);
    expect(bad.runs.rows.get("run-1")?.status).toBe("failed");
  });

  it("uses one run id, and never rejects when the row or target is missing or the runtime throws", async () => {
    const t = setup();
    await runSpecialistForIssue(t.deps, 7);
    expect(t.targetOf).toHaveBeenCalledWith(7, "run-1");
    expect(t.runs.rows.get("run-1")?.id).toBe("run-1");

    const none = setup({ noTarget: true });
    await expect(runSpecialistForIssue(none.deps, 7)).resolves.toEqual(NOT);
    expect(none.run).not.toHaveBeenCalled();

    const noRow = setup({ noRow: true });
    await expect(runSpecialistForIssue(noRow.deps, 7)).resolves.toEqual(NOT);
    expect(noRow.log).toHaveBeenCalled();
    expect(noRow.targetOf).not.toHaveBeenCalled();
    expect(noRow.run).not.toHaveBeenCalled();

    const boom = setup({ throws: true });
    await expect(runSpecialistForIssue(boom.deps, 7)).resolves.toEqual(NOT);
    expect(boom.log).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(boom.recordUnknownCost).toHaveBeenCalledWith({
      runId: "run-1",
      issueId: 7,
      maxBudgetUsd: 1,
    });
    expect(boom.runs.rows.get("run-1")?.status).toBe("failed");
  });

  it("records the run cap in the ledger when the finished run has no cost", async () => {
    const t = setup({ recordLedger: true });
    await runSpecialistForIssue(t.deps, 7);
    expect(t.entries).toHaveLength(1);
    expect(t.entries[0]).toMatchObject({ costUsd: 1, costUnknown: true });
  });

  it("does not record unknown cost again when the runtime finished and a later step throws", async () => {
    const t = setup({ recordLedger: true, failOnWorkReported: true });
    await expect(runSpecialistForIssue(t.deps, 7)).resolves.toEqual(NOT);
    expect(t.recordUnknownCost).not.toHaveBeenCalled();
    expect(t.entries).toHaveLength(1);
  });

  it("checks the budget before running and fails closed", async () => {
    const ok = setup({ issueCost: 8 });
    await runSpecialistForIssue(ok.deps, 7);
    expect(ok.run).toHaveBeenCalledTimes(1);
    expect(ok.issues.rows.get(7)?.state).toBe("Verify");

    const over = setup({ issueCost: 8.5 });
    await expect(runSpecialistForIssue(over.deps, 7)).resolves.toEqual(NOT);
    expect(over.issues.rows.get(7)).toMatchObject({
      state: "Held",
      heldReason: "IssueBudgetExceeded",
    });
    expect(over.run).not.toHaveBeenCalled();
    expect(over.runs.rows.size).toBe(0);

    const day = setup({ dayCost: 99 });
    await expect(runSpecialistForIssue(day.deps, 7)).resolves.toEqual(NOT);
    expect(day.issues.rows.get(7)).toMatchObject({ state: "Held", heldReason: "BudgetExhausted" });
    expect(day.run).not.toHaveBeenCalled();
    expect(day.runs.rows.size).toBe(0);

    const broken = setup({ ledgerThrows: true });
    await expect(runSpecialistForIssue(broken.deps, 7)).resolves.toEqual(NOT);
    expect(broken.log).toHaveBeenCalled();
    expect(broken.run).not.toHaveBeenCalled();
    expect(broken.runs.rows.size).toBe(0);
    expect(broken.issues.rows.get(7)?.state).toBe("InProgress");
  });

  it("is exported by the package index", () => {
    for (const name of [
      "applySpecialistOutcome",
      "runSpecialistForIssue",
      "buildSpecialistRequest",
      "feedbackOf",
      "criteriaOf",
    ]) {
      expect(typeof (daemon as Record<string, unknown>)[name]).toBe("function");
    }
  });
});
