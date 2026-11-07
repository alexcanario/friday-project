import type { AgentRuntime, ToolDenialSink } from "@friday/application";
import { RUN_STATUSES, type RunFinished } from "@friday/contracts";
import { describe, expect, it } from "vitest";
import { createRunRecorder, createTicker, type RunRecordingDeps } from "../src/index.ts";
import {
  FakeClock,
  FakeEvents,
  FakeIssueRepository,
  FakeIssues,
  FakeRunRepository,
  PendingRuntime,
  fakeRequest,
} from "./fakes.ts";

function finished(status: RunFinished["status"]): RunFinished {
  return {
    status,
    subtype: null,
    model: null,
    costUsd: null,
    tokens: null,
    numTurns: null,
    durationMs: null,
    output: null,
    violations: [],
  };
}

type Options = { maxConcurrentRuns?: number; ids?: boolean; withRecording?: boolean };

function setup(options: Options = {}) {
  const order: string[] = [];
  const clock = new FakeClock();
  const issues = new FakeIssues();
  const events = new FakeEvents(order);
  const runs = new FakeRunRepository(order);
  const runtime = new PendingRuntime(order);
  const issueRepo = new FakeIssueRepository(events, order);
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
    now: () => new Date("2026-11-05T03:00:00.000Z"),
  });
  const built: unknown[][] = [];
  const logs: string[] = [];
  let n = 0;
  const recording: RunRecordingDeps = {
    runs,
    recorder,
    ...(options.ids ? {} : { newRunId: () => `r${(n += 1)}` }),
  };
  const ticker = createTicker({
    projectId: "p",
    clock,
    readConfig: () => ({ enabled: true, maxConcurrentRuns: options.maxConcurrentRuns ?? 1 }),
    issues,
    buildRequest: (...args: [number, string?]) => {
      built.push(args);
      return fakeRequest(args[0]);
    },
    runtime,
    events,
    log: (m) => logs.push(m),
    ...(options.withRecording === false ? {} : { recording }),
  });
  return { order, clock, issues, events, runs, runtime, issueRepo, built, logs, ticker, recording };
}

const types = (events: FakeEvents) => events.appended.map((e) => e.type);

describe("run registration", () => {
  it("saves the running row before the event and the run", async () => {
    const t = setup();
    t.issues.ready = [7];
    await t.ticker.tick();
    expect(t.built).toEqual([[7, "r1"]]);
    expect(t.runs.rows.get("r1")).toEqual({
      id: "r1",
      projectId: "p",
      issueId: 7,
      phase: null,
      startedAt: "1970-01-01T00:00:00.000Z",
      finishedAt: null,
      status: "running",
    });
    expect(t.events.appended).toHaveLength(1);
    expect(t.events.appended[0]).toMatchObject({
      type: "RunDispatched",
      runId: "r1",
      issueId: 7,
      actor: "daemon",
    });
    expect(t.order).toEqual(["runs.save", "events.append", "runtime.run"]);
    expect(types(t.events).filter((x) => x === "RunDispatched")).toHaveLength(1);
  });

  it("records no RunDispatched when runtimeFor throws", async () => {
    const t = setup();
    t.recording.runtimeFor = () => {
      throw new Error("boom");
    };
    t.issues.ready = [7];
    await t.ticker.tick();
    expect(t.events.appended).toHaveLength(0);
    expect(t.runtime.requests).toHaveLength(0);
  });

  it("fails the row and logs the dispatch error when runtimeFor throws", async () => {
    const t = setup();
    t.recording.runtimeFor = () => {
      throw new Error("boom");
    };
    t.issues.ready = [7];
    await t.ticker.tick();
    const row = t.runs.rows.get("r1");
    expect(row?.status).toBe("failed");
    expect(row?.finishedAt).not.toBeNull();
    expect(t.logs).toContain("Failed to dispatch issue 7: boom");
  });

  it("finishes the row as succeeded and records only RunFinished", async () => {
    const t = setup();
    t.issues.ready = [7];
    await t.ticker.tick();
    t.clock.advance(5000);
    const result = finished("succeeded");
    t.runtime.resolveAll(result);
    await t.ticker.idle();
    expect(t.runs.rows.get("r1")).toMatchObject({
      finishedAt: "1970-01-01T00:00:05.000Z",
      status: "succeeded",
    });
    expect(types(t.events)).toEqual(["RunDispatched", "RunFinished"]);
    expect(t.events.appended[1]).toMatchObject({ runId: "r1", payload: result });
    expect(t.issueRepo.rebuilds).toHaveLength(0);
  });

  it("finishes the row as failed for every failing status and holds the issue", async () => {
    const failing = RUN_STATUSES.filter((s) => s !== "succeeded");
    expect(failing).toHaveLength(6);
    for (const status of failing) {
      const t = setup();
      t.issues.ready = [7];
      await t.ticker.tick();
      t.runtime.resolveAll(finished(status));
      await t.ticker.idle();
      const row = t.runs.rows.get("r1");
      expect(row?.status).toBe("failed");
      expect(row?.finishedAt).not.toBeNull();
      if (status === "budget_exceeded") {
        expect(types(t.events)).toEqual(["RunDispatched", "RunFinished", "StateChanged"]);
        expect(t.events.appended[2]).toMatchObject({
          runId: "r1",
          payload: { heldReason: "BudgetExceeded", to: "Held" },
        });
        expect(t.issueRepo.rebuilds).toMatchObject([{ projectId: "p" }]);
      }
    }
  });

  it("finishes the row as failed when the runtime rejects", async () => {
    const t = setup();
    t.issues.ready = [7];
    await t.ticker.tick();
    t.runtime.rejectAll(new Error("boom"));
    await t.ticker.idle();
    const row = t.runs.rows.get("r1");
    expect(row?.status).toBe("failed");
    expect(row?.finishedAt).not.toBeNull();
    expect(types(t.events)).toEqual(["RunDispatched"]);
    expect(t.logs).toContain("Run failed for issue 7: boom");
    await t.ticker.tick();
    expect(t.built).toEqual([
      [7, "r1"],
      [7, "r2"],
    ]);
  });

  it("still finishes the row when the recorder fails", async () => {
    const t = setup();
    t.issues.ready = [7];
    await t.ticker.tick();
    t.events.failWhen = (e) => (e.type === "RunFinished" ? new Error("boom") : null);
    t.runtime.resolveAll(finished("succeeded"));
    await t.ticker.idle();
    const row = t.runs.rows.get("r1");
    expect(row?.status).toBe("succeeded");
    expect(row?.finishedAt).not.toBeNull();
    expect(t.logs).toContain("Failed to record run r1: boom");

    const u = setup();
    u.issues.ready = [7];
    await u.ticker.tick();
    u.runs.saveFailWhen = (r) => (r.status === "succeeded" ? new Error("boom") : null);
    u.runtime.resolveAll(finished("succeeded"));
    await u.ticker.idle();
    expect(u.logs).toContain("Failed to finish run r1: boom");
  });

  it("passes the request budget in the run context", async () => {
    const t = setup();
    const seen: unknown[] = [];
    t.recording.runtimeFor = (ctx) => {
      seen.push(ctx);
      return t.runtime;
    };
    t.issues.ready = [7];
    await t.ticker.tick();
    expect(seen).toEqual([{ runId: "r1", issueId: 7, maxBudgetUsd: 1 }]);
    t.runtime.resolveAll(finished("succeeded"));
    await t.ticker.idle();
  });

  it("gives each run its own runtime and denial sink", async () => {
    const t = setup();
    const own = new PendingRuntime();
    const calls: { ctx: unknown; sink: ToolDenialSink }[] = [];
    const runtimeFor = (ctx: { runId: string; issueId: number }, sink: ToolDenialSink) => {
      calls.push({ ctx, sink });
      return own satisfies AgentRuntime;
    };
    t.recording.runtimeFor = runtimeFor;
    t.issues.ready = [7];
    await t.ticker.tick();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.ctx).toEqual({ runId: "r1", issueId: 7, maxBudgetUsd: 1 });
    expect(own.requests).toHaveLength(1);
    expect(t.runtime.requests).toHaveLength(0);
    const denial = { toolName: "Bash", toolUseId: "t1" };
    calls[0]?.sink.record(denial);
    calls[0]?.sink.record(denial);
    const denied = t.events.appended.filter((e) => e.type === "ToolDenied");
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ runId: "r1", issueId: 7, payload: denial });
    expect(types(t.events).filter((x) => x === "RunDispatched")).toHaveLength(1);
    own.resolveAll(finished("succeeded"));
    await t.ticker.idle();

    const plain = setup();
    plain.issues.ready = [7];
    await plain.ticker.tick();
    expect(plain.runtime.requests).toHaveLength(1);
  });

  it("does not dispatch when the row cannot be saved and fails the row when the event cannot be appended", async () => {
    const t = setup();
    t.issues.ready = [7];
    t.runs.saveFailure = new Error("boom");
    await t.ticker.tick();
    expect(t.runtime.requests).toHaveLength(0);
    expect(types(t.events)).toEqual([]);
    expect(t.logs).toEqual(["Failed to dispatch issue 7: boom"]);
    t.runs.saveFailure = null;
    await t.ticker.tick();
    expect(t.runtime.requests).toHaveLength(1);

    const u = setup();
    u.issues.ready = [7];
    u.events.failWhen = (e) => (e.type === "RunDispatched" ? new Error("boom") : null);
    await u.ticker.tick();
    const row = u.runs.rows.get("r1");
    expect(row?.status).toBe("failed");
    expect(row?.finishedAt).not.toBeNull();
    expect(u.runtime.requests).toHaveLength(0);
  });

  it("generates a distinct uuid per run by default", async () => {
    const t = setup({ ids: true, maxConcurrentRuns: 2 });
    t.issues.ready = [7, 8];
    await t.ticker.tick();
    const rows = [...t.runs.rows.values()];
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const row of rows) {
      expect(row.id).toMatch(uuid);
      const event = t.events.appended.find((e) => e.issueId === row.issueId);
      expect(event?.runId).toBe(row.id);
    }
  });

  it("keeps the previous behavior without recording", async () => {
    const t = setup({ withRecording: false });
    t.issues.ready = [7];
    await t.ticker.tick();
    expect(t.events.appended[0]).toMatchObject({ type: "RunDispatched", runId: null });
    expect(t.built).toEqual([[7]]);
    expect(t.runs.calls).toBe(0);
  });
});
