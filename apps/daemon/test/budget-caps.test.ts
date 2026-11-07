import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAgentRuntime, type LedgerRepository } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import {
  createEventStore,
  createIssueRepository,
  createLedgerRepository,
  createRunRepository,
  openDatabase,
} from "@friday/infrastructure";
import { describe, expect, it } from "vitest";
import { createRunRecorder, createTicker } from "../src/index.ts";
import { FakeClock, FakeIssues, fakeRequest } from "./fakes.ts";

const DAY = "2026-11-07";

function finished(costUsd: number | null): RunFinished {
  return {
    status: "succeeded",
    subtype: null,
    model: null,
    costUsd,
    tokens: null,
    numTurns: null,
    durationMs: null,
    output: null,
    violations: [],
  };
}

type Options = {
  perDayUsd?: number;
  perIssueUsd?: number;
  budget?: boolean;
  state?: string;
  cost?: number | null;
  buildFails?: Error;
};

function setup(o: Options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "friday-budget-"));
  const db = openDatabase(join(dir, "friday.db"));
  db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p')").run();
  const events = createEventStore(db);
  const issues = createIssueRepository(db);
  const state = o.state ?? "InProgress";
  events.append({
    type: "StateChanged",
    projectId: "p",
    issueId: 7,
    runId: null,
    actor: "seed",
    at: "2026-11-05T02:00:00.000Z",
    payload: {
      type: "StateChanged",
      issueId: "7",
      from: "Todo",
      to: state,
      trigger: "SpecialistAssigned",
      heldReason: null,
      verifyRound: 0,
      qaRound: 0,
      reviewIter: 0,
    },
  });
  issues.rebuild("p");
  const runs = createRunRepository(db);
  const realLedger = createLedgerRepository(db);
  const ledger: LedgerRepository & { failSums: Error | null } = {
    failSums: null,
    record: (e) => realLedger.record(e),
    sumByDay: (p, d) => {
      if (ledger.failSums) throw ledger.failSums;
      return realLedger.sumByDay(p, d);
    },
    sumByIssue: (p, i) => {
      if (ledger.failSums) throw ledger.failSums;
      return realLedger.sumByIssue(p, i);
    },
  };
  const clock = new FakeClock();
  clock.advance(Date.parse(`${DAY}T10:00:00.000Z`));
  const recorderDeps = {
    projectId: "p",
    events,
    issues,
    now: () => new Date(clock.now()),
    ledger,
  };
  const runtime = new FakeAgentRuntime([finished(o.cost === undefined ? 0.001 : o.cost)]);
  const source = new FakeIssues();
  source.ready = [7];
  const logs: string[] = [];
  const config = { perDayUsd: o.perDayUsd ?? 10, perIssueUsd: o.perIssueUsd ?? 5 };
  const ticker = createTicker({
    projectId: "p",
    clock,
    readConfig: () => ({ enabled: true, maxConcurrentRuns: 1, ...config }),
    issues: source,
    buildRequest: (id) => {
      if (o.buildFails) throw o.buildFails;
      const request = fakeRequest(id);
      return { ...request, agent: { ...request.agent, maxBudgetUsd: 0.01 } };
    },
    runtime,
    events,
    log: (m) => logs.push(m),
    recording: { runs, recorder: createRunRecorder(recorderDeps) },
    ...(o.budget === false ? {} : { budget: { ledger, recorderDeps } }),
  });
  const spend = (issueId: number, costUsd: number, day = DAY, costUnknown = false) =>
    realLedger.record({
      projectId: "p",
      issueId,
      runId: `seed-${issueId}-${day}-${costUsd}`,
      day,
      costUsd,
      costUnknown,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      numTurns: null,
    });
  const runCount = () =>
    (db.sqlite.prepare("SELECT COUNT(*) AS n FROM runs").get() as { n: number }).n;
  const dispatched = () => events.list("p", 7).filter((e) => e.type === "RunDispatched").length;
  return {
    config,
    db,
    events,
    issues,
    ledger,
    realLedger,
    runtime,
    logs,
    ticker,
    spend,
    runCount,
    dispatched,
  };
}

describe("budget caps", () => {
  it("skips the budget check without deps.budget", async () => {
    const t = setup({ budget: false, perDayUsd: 0.05 });
    t.spend(8, 100);
    await t.ticker.tick();
    await t.ticker.idle();
    expect(t.runtime.requests).toHaveLength(1);
  });

  it("holds BudgetExhausted at the daily cap without calling the runtime", async () => {
    const t = setup({ perDayUsd: 0.05 });
    t.spend(8, 0.04);
    await t.ticker.tick();
    await t.ticker.idle();
    expect(t.runtime.requests).toHaveLength(0);
    expect(t.runCount()).toBe(0);
    expect(t.dispatched()).toBe(0);
    expect(t.issues.get("p", 7)).toMatchObject({ state: "Held", heldReason: "BudgetExhausted" });
  });

  it("dispatches at exactly the daily cap and ignores earlier days", async () => {
    const t = setup({ perDayUsd: 0.05 });
    t.spend(8, 0.03);
    t.spend(8, 5, "2026-11-06");
    await t.ticker.tick();
    await t.ticker.idle();
    expect(t.runtime.requests).toHaveLength(1);
    expect(t.runCount()).toBe(1);
    expect(t.issues.get("p", 7)?.state).not.toBe("Held");
  });

  it("holds IssueBudgetExceeded over the issue cap", async () => {
    const hot = setup({ perIssueUsd: 0.05 });
    hot.spend(7, 0.04);
    await hot.ticker.tick();
    await hot.ticker.idle();
    expect(hot.runtime.requests).toHaveLength(0);
    expect(hot.runCount()).toBe(0);
    expect(hot.issues.get("p", 7)).toMatchObject({
      state: "Held",
      heldReason: "IssueBudgetExceeded",
    });
    const edge = setup({ perIssueUsd: 0.05 });
    edge.spend(7, 0.03);
    await edge.ticker.tick();
    await edge.ticker.idle();
    expect(edge.runtime.requests).toHaveLength(1);
  });

  it("counts unknown cost like known cost and ignores other issues", async () => {
    const unknown = setup({ perIssueUsd: 0.05 });
    unknown.spend(7, 0.04, DAY, true);
    await unknown.ticker.tick();
    expect(unknown.issues.get("p", 7)).toMatchObject({ heldReason: "IssueBudgetExceeded" });
    const other = setup({ perIssueUsd: 0.05 });
    other.spend(8, 0.04);
    await other.ticker.tick();
    await other.ticker.idle();
    expect(other.runtime.requests).toHaveLength(1);
  });

  it("does not dispatch when RunHeld is not accepted", async () => {
    const t = setup({ perDayUsd: 0.05, state: "Backlog" });
    t.spend(8, 0.04);
    await t.ticker.tick();
    await t.ticker.idle();
    expect(t.runtime.requests).toHaveLength(0);
    expect(t.runCount()).toBe(0);
    expect(t.issues.get("p", 7)?.state).toBe("Backlog");
    expect(t.logs.some((l) => l.includes("issue 7"))).toBe(true);
  });

  it("logs and skips when buildRequest throws", async () => {
    const t = setup({ buildFails: new Error("sem prompt") });
    await t.ticker.tick();
    expect(t.runtime.requests).toHaveLength(0);
    expect(t.logs).toContain("Failed to dispatch issue 7: sem prompt");
  });

  it("does not dispatch when the ledger read throws", async () => {
    const t = setup();
    t.ledger.failSums = new Error("disk");
    await t.ticker.tick();
    await t.ticker.idle();
    expect(t.runtime.requests).toHaveLength(0);
    expect(t.runCount()).toBe(0);
    expect(t.dispatched()).toBe(0);
    expect(t.issues.get("p", 7)?.state).toBe("InProgress");
    expect(t.logs).toContain("Failed to dispatch issue 7: disk");
  });

  it("ledger receives the cost of a dispatched run", async () => {
    const t = setup({ cost: 0.12 });
    await t.ticker.tick();
    await t.ticker.idle();
    const expected = { costUsd: 0.12, anyCostUnknown: false };
    expect(t.realLedger.sumByDay("p", DAY)).toEqual(expected);
    expect(t.realLedger.sumByIssue("p", 7)).toEqual(expected);
  });

  it("a second tick sees the cost recorded by the first", async () => {
    const t = setup({ cost: 0.12 });
    await t.ticker.tick();
    await t.ticker.idle();
    expect(t.runtime.requests).toHaveLength(1);
    t.config.perDayUsd = 0.05;
    await t.ticker.tick();
    await t.ticker.idle();
    expect(t.runtime.requests).toHaveLength(1);
    expect(t.issues.get("p", 7)).toMatchObject({
      state: "Held",
      heldReason: "BudgetExhausted",
    });
  });
});
