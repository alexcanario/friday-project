import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunRequest, AgentRuntime, LedgerRepository } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import {
  createBreakerStateRepository,
  createEventStore,
  createIssueRepository,
  createLedgerRepository,
  createRunRepository,
  openDatabase,
} from "@friday/infrastructure";
import { describe, expect, it } from "vitest";
import { createBreaker, createRunRecorder, createTicker } from "../src/index.ts";
import { beginRun, completeRun, type RegistrationEnv } from "../src/run-registration.ts";
import {
  FakeClock,
  FakeEvents,
  FakeIssueRepository,
  FakeIssues,
  FakeRunRepository,
  fakeRequest,
} from "./fakes.ts";

const T0 = Date.parse("2026-11-07T10:00:00.000Z");
const MIN = 60000;

function finished(status: RunFinished["status"] = "succeeded"): RunFinished {
  return {
    status,
    subtype: null,
    model: null,
    costUsd: 0.001,
    tokens: null,
    numTurns: null,
    durationMs: null,
    output: null,
    violations: [],
  };
}

type Step = RunFinished["status"] | Error;

class ScriptedRuntime implements AgentRuntime {
  readonly requests: AgentRunRequest[] = [];
  constructor(private readonly steps: Step[]) {}
  run(request: AgentRunRequest): Promise<RunFinished> {
    this.requests.push(request);
    const step = this.steps.shift() ?? "succeeded";
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(finished(step));
  }
}

describe("onRuntimeFailure in completeRun", () => {
  function regSetup(steps: Step[], recordFails = false) {
    const events = new FakeEvents();
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
      now: () => new Date(T0),
    });
    if (recordFails) {
      recorder.recordFinished = () => {
        throw new Error("record");
      };
    }
    const logs: string[] = [];
    const calls = { n: 0, fail: false };
    const env: RegistrationEnv = {
      projectId: "p",
      now: () => new Date(T0).toISOString(),
      events,
      runtime: new ScriptedRuntime(steps),
      buildRequest: (id) => fakeRequest(id),
      recording: { runs, recorder, newRunId: () => "r1" },
      logError: (m, e) => logs.push(`${m}: ${e instanceof Error ? e.message : String(e)}`),
      onRuntimeFailure: () => {
        calls.n += 1;
        if (calls.fail) throw new Error("breaker");
      },
    };
    return { env, calls, logs, runs };
  }

  const exec = async (t: ReturnType<typeof regSetup>) => completeRun(t.env, beginRun(t.env, 7));

  it("calls onRuntimeFailure only for failed, timeout and a thrown run", async () => {
    const expected: [Step, number][] = [
      ["failed", 1],
      ["timeout", 1],
      [new Error("boom"), 1],
      ["succeeded", 0],
      ["budget_exceeded", 0],
      ["turns_exceeded", 0],
      ["invalid_output", 0],
      ["misconfigured", 0],
    ];
    for (const [step, n] of expected) {
      const t = regSetup([step]);
      await exec(t);
      expect(t.calls.n, String(step)).toBe(n);
    }
    const t = regSetup(["failed"], true);
    await exec(t);
    expect(t.calls.n).toBe(1);
  });

  it("logs a throwing onRuntimeFailure and still closes the run", async () => {
    const t = regSetup(["failed"]);
    t.calls.fail = true;
    await exec(t);
    expect(t.logs).toContain("Failed to record breaker failure for run r1: breaker");
    expect(t.runs.rows.get("r1")?.status).toBe("failed");
    expect(t.calls.n).toBe(1);
  });
});

type Options = { state?: string; steps?: Step[]; isOpenThrows?: boolean; open?: boolean };

function setup(o: Options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "friday-breaker-"));
  const db = openDatabase(join(dir, "friday.db"));
  db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p')").run();
  const events = createEventStore(db);
  const issues = createIssueRepository(db);
  for (const id of [7, 8, 9, 10, 11, 12]) {
    events.append({
      type: "StateChanged",
      projectId: "p",
      issueId: id,
      runId: null,
      actor: "seed",
      at: "2026-11-05T02:00:00.000Z",
      payload: {
        type: "StateChanged",
        issueId: String(id),
        from: "Todo",
        to: o.state ?? "InProgress",
        trigger: "SpecialistAssigned",
        heldReason: null,
        verifyRound: 0,
        qaRound: 0,
        reviewIter: 0,
      },
    });
  }
  issues.rebuild("p");
  const runs = createRunRepository(db);
  const realLedger = createLedgerRepository(db);
  const sums = { n: 0 };
  const ledger: LedgerRepository = {
    record: (e) => realLedger.record(e),
    sumByDay: (p, d) => {
      sums.n += 1;
      return realLedger.sumByDay(p, d);
    },
    sumByIssue: (p, i) => {
      sums.n += 1;
      return realLedger.sumByIssue(p, i);
    },
  };
  const clock = new FakeClock();
  clock.advance(T0);
  const recorderDeps = {
    projectId: "p",
    events,
    issues,
    now: () => new Date(clock.now()),
    ledger,
  };
  const real = createBreaker({
    now: () => new Date(clock.now()),
    threshold: 3,
    windowMs: 900000,
    openMs: 1800000,
    persist: { store: createBreakerStateRepository(db), projectId: "p" },
  });
  const breaker = {
    isOpen: () => {
      if (o.isOpenThrows) throw new Error("estado ilegível");
      return o.open ?? real.isOpen();
    },
    recordFailure: () => real.recordFailure(),
  };
  const runtime = new ScriptedRuntime(o.steps ?? []);
  const source = new FakeIssues();
  source.ready = [7];
  const logs: string[] = [];
  const base = {
    projectId: "p",
    clock,
    readConfig: () => ({ enabled: true, maxConcurrentRuns: 4, perDayUsd: 10, perIssueUsd: 5 }),
    issues: source,
    buildRequest: (id: number) => fakeRequest(id),
    runtime,
    events,
    log: (m: string) => logs.push(m),
    recording: { runs, recorder: createRunRecorder(recorderDeps) },
    budget: { ledger, recorderDeps },
  };
  const make = (withBreaker: boolean) =>
    createTicker({ ...base, ...(withBreaker ? { breaker: { breaker, recorderDeps } } : {}) });
  const runCount = () =>
    (db.sqlite.prepare("SELECT COUNT(*) AS n FROM runs").get() as { n: number }).n;
  const dispatched = (id = 7) =>
    events.list("p", id).filter((e) => e.type === "RunDispatched").length;
  return {
    db,
    events,
    issues,
    clock,
    runtime,
    source,
    logs,
    sums,
    real,
    runCount,
    dispatched,
    ticker: make(true),
    plain: make(false),
    recorderDeps,
  };
}

describe("breaker in the ticker", () => {
  it("holds BreakerOpen without calling the runtime", async () => {
    const t = setup({ open: true });
    await t.ticker.tick();
    await t.ticker.idle();
    expect(t.runtime.requests).toHaveLength(0);
    expect(t.runCount()).toBe(0);
    expect(t.dispatched()).toBe(0);
    expect(t.issues.get("p", 7)).toMatchObject({ state: "Held", heldReason: "BreakerOpen" });
    const closed = setup({ open: false });
    await closed.ticker.tick();
    await closed.ticker.idle();
    expect(closed.runtime.requests).toHaveLength(1);
  });

  it("does not dispatch when RunHeld is not accepted or isOpen throws", async () => {
    const backlog = setup({ open: true, state: "Backlog" });
    await backlog.ticker.tick();
    await backlog.ticker.idle();
    expect(backlog.runtime.requests).toHaveLength(0);
    expect(backlog.runCount()).toBe(0);
    expect(backlog.issues.get("p", 7)?.state).toBe("Backlog");
    expect(backlog.logs.some((l) => l.includes("issue 7"))).toBe(true);

    const bad = setup({ isOpenThrows: true });
    await bad.ticker.tick();
    await bad.ticker.idle();
    expect(bad.runtime.requests).toHaveLength(0);
    expect(bad.runCount()).toBe(0);
    expect(bad.dispatched()).toBe(0);
    expect(bad.issues.get("p", 7)?.state).toBe("InProgress");
    expect(bad.logs).toContain("Failed to dispatch issue 7: estado ilegível");
  });

  it("dispatches normally without deps.breaker", async () => {
    const t = setup({ open: true });
    await t.plain.tick();
    await t.plain.idle();
    expect(t.runtime.requests).toHaveLength(1);
    expect(t.issues.get("p", 7)?.heldReason).not.toBe("BreakerOpen");
  });

  it("checks the breaker before the budget", async () => {
    const open = setup({ open: true });
    await open.ticker.tick();
    expect(open.issues.get("p", 7)).toMatchObject({ heldReason: "BreakerOpen" });
    expect(open.sums.n).toBe(0);
    const closed = setup({ open: false });
    closed.db.sqlite
      .prepare(
        "INSERT INTO ledger (project_id, run_id, day, cost_usd, issue_id) VALUES ('p','x','2026-11-07',100,8)",
      )
      .run();
    await closed.ticker.tick();
    expect(closed.issues.get("p", 7)).toMatchObject({ heldReason: "BudgetExhausted" });
    expect(closed.runtime.requests).toHaveLength(0);
  });
});

describe("breaker end to end", () => {
  async function runOne(t: ReturnType<typeof setup>, id: number) {
    t.source.ready = [id];
    await t.ticker.tick();
    await t.ticker.idle();
  }

  it("opens after three runtime failures and closes after 30 minutes", async () => {
    const t = setup({ steps: ["failed", "timeout", new Error("boom")] });
    for (const id of [7, 8, 9]) await runOne(t, id);
    expect(t.real.isOpen()).toBe(true);
    const row = t.db.sqlite.prepare("SELECT opened_at FROM breaker_state").get() as {
      opened_at: string | null;
    };
    expect(row.opened_at).not.toBeNull();
    await runOne(t, 10);
    expect(t.runtime.requests).toHaveLength(3);
    expect(t.issues.get("p", 10)).toMatchObject({ state: "Held", heldReason: "BreakerOpen" });
    t.clock.advance(30 * MIN);
    await runOne(t, 11);
    expect(t.runtime.requests).toHaveLength(4);
  });

  it("other statuses do not open the breaker", async () => {
    const t = setup({ steps: ["failed", "timeout", "succeeded", "budget_exceeded"] });
    for (const id of [7, 8, 9, 10]) await runOne(t, id);
    expect(t.real.isOpen()).toBe(false);
    await runOne(t, 11);
    expect(t.runtime.requests).toHaveLength(5);
  });
});
