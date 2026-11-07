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
  type FridayDatabase,
} from "@friday/infrastructure";
import { createBreaker, createRunRecorder, createTicker } from "../src/index.ts";
import { FakeClock, FakeIssues, fakeRequest } from "./fakes.ts";

export const T0 = Date.parse("2026-11-07T10:00:00.000Z");
export const MIN = 60000;

export function finished(status: RunFinished["status"] = "succeeded"): RunFinished {
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

export type Step = RunFinished["status"] | Error;

export class ScriptedRuntime implements AgentRuntime {
  readonly requests: AgentRunRequest[] = [];
  readonly steps: Step[];
  constructor(steps: Step[]) {
    this.steps = steps;
  }
  run(request: AgentRunRequest): Promise<RunFinished> {
    this.requests.push(request);
    const step = this.steps.shift() ?? "succeeded";
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(finished(step));
  }
}

export type Options = { state?: string; steps?: Step[]; isOpenThrows?: boolean; open?: boolean };

function seedIssues(db: FridayDatabase, state: string): void {
  const events = createEventStore(db);
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
        to: state,
        trigger: "SpecialistAssigned",
        heldReason: null,
        verifyRound: 0,
        qaRound: 0,
        reviewIter: 0,
      },
    });
  }
  createIssueRepository(db).rebuild("p");
}

function countingLedger(db: FridayDatabase) {
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
  return { ledger, sums };
}

function wrapBreaker(db: FridayDatabase, clock: FakeClock, o: Options) {
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
  return { real, breaker };
}

function buildTickers(
  db: FridayDatabase,
  clock: FakeClock,
  o: Options,
  breaker: ReturnType<typeof wrapBreaker>["breaker"],
) {
  const events = createEventStore(db);
  const { ledger, sums } = countingLedger(db);
  const recorderDeps = {
    projectId: "p",
    events,
    issues: createIssueRepository(db),
    now: () => new Date(clock.now()),
    ledger,
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
    recording: { runs: createRunRepository(db), recorder: createRunRecorder(recorderDeps) },
    budget: { ledger, recorderDeps },
  };
  const make = (withBreaker: boolean) =>
    createTicker({ ...base, ...(withBreaker ? { breaker: { breaker, recorderDeps } } : {}) });
  return { runtime, source, logs, sums, recorderDeps, ticker: make(true), plain: make(false) };
}

export function setup(o: Options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "friday-breaker-"));
  const db = openDatabase(join(dir, "friday.db"));
  db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p')").run();
  seedIssues(db, o.state ?? "InProgress");
  const events = createEventStore(db);
  const clock = new FakeClock();
  clock.advance(T0);
  const { real, breaker } = wrapBreaker(db, clock, o);
  const parts = buildTickers(db, clock, o, breaker);
  const runCount = () =>
    (db.sqlite.prepare("SELECT COUNT(*) AS n FROM runs").get() as { n: number }).n;
  const dispatched = (id = 7) =>
    events.list("p", id).filter((e) => e.type === "RunDispatched").length;
  return {
    db,
    events,
    issues: createIssueRepository(db),
    clock,
    real,
    runCount,
    dispatched,
    ...parts,
  };
}
