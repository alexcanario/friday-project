import type { ToolDenialSink } from "@friday/application";
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

function setup() {
  const events = new FakeEvents();
  const issues = new FakeIssues();
  const issueRepo = new FakeIssueRepository(events);
  const recorder = createRunRecorder({
    projectId: "p",
    events,
    issues: issueRepo,
    now: () => new Date("2026-11-05T03:00:00.000Z"),
  });
  const sinks: ToolDenialSink[] = [];
  const runtimes: PendingRuntime[] = [];
  let n = 0;
  const recording: RunRecordingDeps = {
    runs: new FakeRunRepository(),
    recorder,
    newRunId: () => `r${(n += 1)}`,
    runtimeFor: (_ctx, sink) => {
      const own = new PendingRuntime();
      sinks.push(sink);
      runtimes.push(own);
      return own;
    },
  };
  const ticker = createTicker({
    projectId: "p",
    clock: new FakeClock(),
    readConfig: () => ({ enabled: true, maxConcurrentRuns: 2, perIssueUsd: 5, perDayUsd: 10 }),
    issues,
    buildRequest: (issueId: number) => fakeRequest(issueId),
    runtime: new PendingRuntime(),
    events,
    log: () => undefined,
    recording,
  });
  return { events, issues, sinks, runtimes, ticker };
}

const denial = { toolName: "Bash", toolUseId: "t1" };

describe("run registration with two runs", () => {
  it("records one ToolDenied per run for the same toolUseId across two runs", async () => {
    const t = setup();
    t.issues.ready = [7, 8];
    await t.ticker.tick();
    expect(t.sinks).toHaveLength(2);
    expect(t.runtimes[0]).not.toBe(t.runtimes[1]);
    for (const sink of t.sinks) sink.record(denial);
    const denied = t.events.appended.filter((e) => e.type === "ToolDenied");
    expect(denied).toHaveLength(2);
    expect(denied.find((e) => e.runId === "r1")).toMatchObject({ issueId: 7, payload: denial });
    expect(denied.find((e) => e.runId === "r2")).toMatchObject({ issueId: 8, payload: denial });
  });

  it("rejects a duplicate toolUseId inside the same run", async () => {
    const t = setup();
    t.issues.ready = [7, 8];
    await t.ticker.tick();
    for (const sink of t.sinks) {
      sink.record(denial);
      sink.record(denial);
    }
    const denied = t.events.appended.filter((e) => e.type === "ToolDenied");
    expect(denied).toHaveLength(2);
    expect(new Set(denied.map((e) => e.runId))).toEqual(new Set(["r1", "r2"]));
  });
});
