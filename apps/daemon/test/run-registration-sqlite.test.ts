import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunRequest } from "@friday/application";
import {
  createEventStore,
  createIssueRepository,
  createRunLookup,
  createRunRepository,
  openDatabase,
  type FridayDatabase,
} from "@friday/infrastructure";
import { describe, expect, it } from "vitest";
import { createRunRecorder, createTicker } from "../src/index.ts";
import { FakeClock, FakeIssues, PendingRuntime, fakeRequest } from "./fakes.ts";
import type { RunResult } from "./fakes.ts";

function setup(withProject: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "friday-reg-"));
  const db: FridayDatabase = openDatabase(join(dir, "friday.db"));
  if (withProject) db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p')").run();
  const events = createEventStore(db);
  const issues = createIssueRepository(db);
  if (withProject) {
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
        to: "InProgress",
        trigger: "SpecialistAssigned",
        heldReason: null,
        verifyRound: 0,
        qaRound: 0,
        reviewIter: 0,
      },
    });
    issues.rebuild("p");
  }
  const runs = createRunRepository(db);
  const recorder = createRunRecorder({ projectId: "p", events, issues, now: () => new Date() });
  const runtime = new PendingRuntime();
  const source = new FakeIssues();
  source.ready = [7];
  const logs: string[] = [];
  const requests: AgentRunRequest[] = [];
  const ticker = createTicker({
    projectId: "p",
    clock: new FakeClock(),
    readConfig: () => ({ enabled: true, maxConcurrentRuns: 1, perIssueUsd: 5, perDayUsd: 10 }),
    issues: source,
    buildRequest: (id, runId) => {
      const request = {
        ...fakeRequest(id),
        friday: { runId: runId ?? "" },
      } as unknown as AgentRunRequest;
      requests.push(request);
      return request;
    },
    runtime,
    events,
    log: (m) => logs.push(m),
    recording: { runs, recorder },
  });
  return { db, events, issues, runs, runtime, logs, ticker, requests };
}

describe("run registration on SQLite", () => {
  it("registers the run in SQLite from dispatch to finish", async () => {
    const t = setup(true);
    await t.ticker.tick();
    const runId = t.requests[0]?.friday?.runId ?? "";
    expect(runId).not.toBe("");
    const active = t.runs.listActive("p");
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: runId, issueId: 7, status: "running" });
    expect(createRunLookup(t.db).isActive(runId)).toBe(true);
    t.runtime.resolveAll({ status: "budget_exceeded", violations: [] } as unknown as RunResult);
    await t.ticker.idle();
    expect(createRunLookup(t.db).isActive(runId)).toBe(false);
    expect(t.runs.listActive("p")).toEqual([]);
    expect(t.issues.get("p", 7)).toMatchObject({ state: "Held", heldReason: "BudgetExceeded" });
    expect(t.events.list("p", 7).map((e) => e.type)).toEqual([
      "StateChanged",
      "RunDispatched",
      "RunFinished",
      "StateChanged",
    ]);
  });

  it("does not dispatch when the project row is missing", async () => {
    const t = setup(false);
    await t.ticker.tick();
    expect(t.runtime.requests).toHaveLength(0);
    expect(t.logs).toHaveLength(1);
    const count = t.db.sqlite.prepare("SELECT COUNT(*) AS n FROM runs").get() as { n: number };
    expect(count.n).toBe(0);
  });
});
