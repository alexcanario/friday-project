import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRuntime, LedgerEntry, LedgerRepository } from "@friday/application";
import {
  createEventStore,
  createIssueRepository,
  createLedgerRepository,
  createRunRepository,
  openDatabase,
} from "@friday/infrastructure";
import type { RunFinished } from "@friday/contracts";
import { describe, expect, it } from "vitest";
import { createRunRecorder } from "../src/index.ts";
import { beginRun, completeRun, type RegistrationEnv } from "../src/run-registration.ts";
import {
  FakeEvents,
  FakeIssueRepository,
  FakeRunRepository,
  PendingRuntime,
  fakeRequest,
} from "./fakes.ts";

class FakeLedger implements LedgerRepository {
  readonly entries: LedgerEntry[] = [];
  record(entry: LedgerEntry): void {
    this.entries.push(entry);
  }
  sumByDay(): { costUsd: number; anyCostUnknown: boolean } {
    return { costUsd: 0, anyCostUnknown: false };
  }
  sumByIssue(): { costUsd: number; anyCostUnknown: boolean } {
    return { costUsd: 0, anyCostUnknown: false };
  }
}

function finished(overrides: Partial<RunFinished> = {}): RunFinished {
  return {
    status: "succeeded",
    subtype: null,
    model: null,
    costUsd: null,
    tokens: null,
    numTurns: null,
    durationMs: null,
    output: null,
    violations: [],
    ...overrides,
  };
}

function setup(withLedger = true) {
  const events = new FakeEvents();
  const ledger = new FakeLedger();
  const runs = new FakeRunRepository();
  const issueRepo = new FakeIssueRepository(events);
  issueRepo.row = {
    projectId: "p",
    issueId: 7,
    state: "InProgress",
    heldReason: null,
    verifyRound: 0,
    qaRound: 0,
    reviewIter: 0,
  };
  const recorder = createRunRecorder({
    projectId: "p",
    events,
    issues: issueRepo,
    now: () => new Date("2026-11-07T10:00:00.000Z"),
    ...(withLedger ? { ledger } : {}),
  });
  const logs: string[] = [];
  const env = (runtime: AgentRuntime): RegistrationEnv => ({
    projectId: "p",
    now: () => "2026-11-07T10:00:00.000Z",
    events,
    runtime,
    buildRequest: (issueId) => fakeRequest(issueId),
    recording: { runs, recorder, newRunId: () => "r1" },
    logError: (m, e) => logs.push(`${m}: ${e instanceof Error ? e.message : String(e)}`),
  });
  return { events, ledger, runs, recorder, env, logs, issueRepo };
}

const ctx = (maxBudgetUsd?: number) => ({
  runId: "r1",
  issueId: 7,
  ...(maxBudgetUsd === undefined ? {} : { maxBudgetUsd }),
});

describe("ledger recording", () => {
  it("records the run ceiling as cost_unknown when cost is null", () => {
    const t = setup();
    t.recorder.recordFinished(ctx(0.5), finished({ costUsd: null }));
    t.recorder.recordFinished({ ...ctx(0.5), runId: "r2" }, finished({ costUsd: 0.12 }));
    t.recorder.recordFinished({ ...ctx(), runId: "r3" }, finished({ costUsd: null }));
    expect(t.ledger.entries.map((e) => [e.costUsd, e.costUnknown])).toEqual([
      [0.5, true],
      [0.12, false],
      [null, true],
    ]);
  });

  it("stores day, tokens and turns of RunFinished", () => {
    const t = setup();
    t.recorder.recordFinished(
      ctx(1),
      finished({
        costUsd: 0.3,
        tokens: { input: 5, output: 6, cacheRead: 7, cacheCreation: 8 },
        numTurns: 3,
      }),
    );
    t.recorder.recordFinished({ ...ctx(1), runId: "r2" }, finished({ costUsd: 0.1 }));
    expect(t.ledger.entries[0]).toEqual({
      projectId: "p",
      issueId: 7,
      runId: "r1",
      day: "2026-11-07",
      costUsd: 0.3,
      costUnknown: false,
      inputTokens: 5,
      outputTokens: 6,
      cacheReadTokens: 7,
      cacheCreationTokens: 8,
      numTurns: 3,
    });
    expect(t.ledger.entries[1]).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      numTurns: null,
    });
  });

  it("records nothing without a ledger", () => {
    const t = setup(false);
    expect(() => t.recorder.recordFinished(ctx(1), finished({ costUsd: 0.1 }))).not.toThrow();
    expect(() => t.recorder.recordUnknownCost(ctx(1))).not.toThrow();
    expect(t.ledger.entries).toHaveLength(0);
    expect(t.events.appended.map((e) => e.type)).toEqual(["RunFinished"]);
  });

  it("records the run ceiling when the runtime throws", async () => {
    const t = setup();
    const runtime = new PendingRuntime();
    const env = t.env(runtime);
    const run = beginRun(env, 7);
    const before = t.events.appended.length;
    const done = completeRun(env, run);
    runtime.rejectAll(new Error("boom"));
    await done;
    expect(t.ledger.entries).toEqual([
      {
        projectId: "p",
        issueId: 7,
        runId: "r1",
        day: "2026-11-07",
        costUsd: 1,
        costUnknown: true,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        numTurns: null,
      },
    ]);
    expect(t.events.appended).toHaveLength(before);
    expect(t.runs.rows.get("r1")?.status).toBe("failed");
  });

  it("logs a failing ledger write and still closes the run as failed", async () => {
    const t = setup();
    t.ledger.record = () => {
      throw new Error("disk");
    };
    const runtime = new PendingRuntime();
    const env = t.env(runtime);
    const done = completeRun(env, beginRun(env, 7));
    runtime.rejectAll(new Error("boom"));
    await done;
    expect(t.logs.some((l) => l.includes("disk"))).toBe(true);
    expect(t.runs.rows.get("r1")?.status).toBe("failed");
  });

  it("does not record unknown cost when the runtime returns", async () => {
    const t = setup();
    const runtime = new PendingRuntime();
    const env = t.env(runtime);
    const done = completeRun(env, beginRun(env, 7));
    runtime.resolveAll(finished({ costUsd: 0.2 }));
    await done;
    expect(t.ledger.entries).toHaveLength(1);
    expect(t.ledger.entries[0]).toMatchObject({ costUsd: 0.2, costUnknown: false });
  });

  it("budget_exceeded fixture holds BudgetExceeded and records its cost", () => {
    const t = setup();
    t.recorder.recordFinished(
      ctx(0.01),
      finished({
        status: "budget_exceeded",
        subtype: "error_max_budget_usd",
        costUsd: 0.0190368,
        numTurns: 1,
        tokens: { input: 1211, output: 108, cacheRead: 2922, cacheCreation: 3299 },
      }),
    );
    const changed = t.events.appended.filter((e) => e.type === "StateChanged");
    expect(changed.map((e) => e.payload)).toMatchObject([
      { to: "Held", heldReason: "BudgetExceeded" },
    ]);
    expect(t.ledger.entries[0]).toMatchObject({
      costUsd: 0.0190368,
      costUnknown: false,
      numTurns: 1,
      inputTokens: 1211,
    });
  });

  it("still applies RunHeld when the ledger write fails", () => {
    const t = setup();
    t.ledger.record = () => {
      throw new Error("disk");
    };
    expect(() =>
      t.recorder.recordFinished(ctx(1), finished({ status: "failed", costUsd: 0.1 })),
    ).toThrow("disk");
    const changed = t.events.appended.filter((e) => e.type === "StateChanged");
    expect(changed).toHaveLength(1);
  });
});

describe("ledger recording on SQLite", () => {
  it("keeps the ceiling in the ledger after a failed record", async () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-ledger-"));
    const db = openDatabase(join(dir, "friday.db"));
    db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p')").run();
    const events = createEventStore(db);
    const issues = createIssueRepository(db);
    events.append({
      type: "StateChanged",
      projectId: "p",
      issueId: 7,
      runId: null,
      actor: "seed",
      at: "2026-11-07T09:00:00.000Z",
      payload: {
        type: "StateChanged",
        issueId: "7",
        from: "Todo",
        to: "InProgress",
        trigger: "SpecialistAssigned",
        heldReason: null,
        verifyRound: 0,
        qaRound: 0,
        reviewIter: 0,
      },
    });
    issues.rebuild("p");
    const real = createLedgerRepository(db);
    let first = true;
    const ledger: LedgerRepository = {
      record: (entry) => {
        if (first) {
          first = false;
          throw new Error("disk");
        }
        real.record(entry);
      },
      sumByDay: (p, d) => real.sumByDay(p, d),
      sumByIssue: (p, i) => real.sumByIssue(p, i),
    };
    const recorder = createRunRecorder({
      projectId: "p",
      events,
      issues,
      now: () => new Date("2026-11-07T10:00:00.000Z"),
      ledger,
    });
    const logs: string[] = [];
    const runtime = new PendingRuntime();
    const env: RegistrationEnv = {
      projectId: "p",
      now: () => "2026-11-07T10:00:00.000Z",
      events,
      runtime,
      buildRequest: (issueId) => fakeRequest(issueId),
      recording: { runs: createRunRepository(db), recorder, newRunId: () => "r1" },
      logError: (m, e) => logs.push(`${m}: ${e instanceof Error ? e.message : String(e)}`),
    };
    const done = completeRun(env, beginRun(env, 7));
    runtime.resolveAll(finished({ costUsd: 0.5 }));
    await done;
    expect(real.sumByIssue("p", 7)).toEqual({ costUsd: 1, anyCostUnknown: true });
    expect(logs.some((l) => l.includes("disk"))).toBe(true);
    db.close();
  });
});
