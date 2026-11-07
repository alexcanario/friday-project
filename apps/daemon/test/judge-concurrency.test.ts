import { describe, expect, it, vi } from "vitest";
import type { IssueRow } from "@friday/application";
import { createStateDispatcher, createTicker, type StateDispatcherDeps } from "../src/index.ts";
import {
  FakeClock,
  FakeEvents,
  FakeGitHub,
  FakeIssueRepository,
  PendingRuntime,
  fakeRequest,
  type RunResult,
} from "./fakes.ts";

type JudgeFn = NonNullable<StateDispatcherDeps["judge"]>;
const done = { applied: true, feedback: null };

const row = (issueId: number, state: string): IssueRow => ({
  projectId: "p",
  issueId,
  state,
  heldReason: null,
  verifyRound: 0,
  qaRound: 0,
  reviewIter: 0,
});

function setup(max: number, judge: JudgeFn, inProgress = true) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events);
  const github = new FakeGitHub();
  for (const id of [7, 8]) {
    github.issues.push({ number: id, title: `t${id}`, body: "", labels: ["friday"] });
  }
  if (inProgress) issues.rows.set(8, row(8, "InProgress"));
  const dispatcher = createStateDispatcher({
    projectId: "p",
    github,
    issues,
    events,
    roles: { specialist: (id) => fakeRequest(id) },
    readConfig: () => null,
    prOf: () => 30,
    now: () => new Date("2026-11-05T03:00:00.000Z"),
    judge,
  });
  const listReady = vi.fn<typeof dispatcher.listReady>((capacity) =>
    dispatcher.listReady(capacity),
  );
  const runtime = new PendingRuntime();
  const ticker = createTicker({
    projectId: "p",
    clock: new FakeClock(),
    readConfig: () => ({ enabled: true, maxConcurrentRuns: max }),
    issues: { listReady, busy: () => dispatcher.busy() },
    buildRequest: (id) => dispatcher.buildRequest(id),
    runtime,
    events,
  });
  return { issues, runtime, ticker, listReady };
}

const toReview = (t: ReturnType<typeof setup>) => t.issues.rows.set(7, row(7, "InReview"));

describe("judge capacity", () => {
  it("does not start the judge when maxConcurrentRuns is full", async () => {
    const judge = vi.fn<JudgeFn>(() => Promise.resolve(done));
    const t = setup(1, judge);
    await t.ticker.tick();
    expect(t.runtime.requests).toHaveLength(1);
    toReview(t);
    await t.ticker.tick();
    expect(judge).toHaveBeenCalledTimes(0);
    expect(t.runtime.requests).toHaveLength(1);
  });

  it("starts the judge once the specialist finishes", async () => {
    const judge = vi.fn<JudgeFn>(() => Promise.resolve(done));
    const t = setup(1, judge);
    await t.ticker.tick();
    toReview(t);
    await t.ticker.tick();
    t.runtime.resolveAll({} as RunResult);
    await t.ticker.idle();
    await t.ticker.tick();
    expect(judge).toHaveBeenCalledTimes(1);
    expect(judge).toHaveBeenCalledWith(7);
  });

  it("runs the judge with a specialist when the limit is 2", async () => {
    let pending = 0;
    const judge = vi.fn<JudgeFn>(async () => {
      pending += 1;
      await Promise.resolve();
      pending -= 1;
      return done;
    });
    const t = setup(2, judge);
    await t.ticker.tick();
    toReview(t);
    await t.ticker.tick();
    expect(judge).toHaveBeenCalledExactlyOnceWith(7);
    expect(t.runtime.requests.length + pending).toBeLessThanOrEqual(2);
  });

  it("never overlaps a judge and a specialist at limit 1", async () => {
    let pending = 0;
    const judge = vi.fn<JudgeFn>(async () => {
      pending += 1;
      await Promise.resolve();
      pending -= 1;
      return done;
    });
    const t = setup(1, judge);
    toReview(t);
    const original = t.runtime.run.bind(t.runtime);
    let seenPending = -1;
    t.runtime.run = (request) => {
      seenPending = pending;
      return original(request);
    };
    await t.ticker.tick();
    expect(judge).toHaveBeenCalledTimes(1);
    expect(t.runtime.requests).toHaveLength(1);
    expect(seenPending).toBe(0);
  });

  it("passes active and max to listReady", async () => {
    const judge = vi.fn<JudgeFn>(() => Promise.resolve(done));
    const t = setup(2, judge);
    await t.ticker.tick();
    await t.ticker.tick();
    expect(t.listReady).toHaveBeenNthCalledWith(1, { active: 0, max: 2 });
    expect(t.listReady).toHaveBeenNthCalledWith(2, { active: 1, max: 2 });
  });

  it("does not dispatch a specialist from an overlapping tick while the judge runs", async () => {
    let release: (v: typeof done) => void = () => {};
    let calls = 0;
    const judge = vi.fn<JudgeFn>(() => {
      calls += 1;
      if (calls > 1) return Promise.resolve(done);
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const t = setup(1, judge);
    toReview(t);
    const first = t.ticker.tick();
    await t.ticker.tick();
    expect(t.runtime.requests).toHaveLength(0);
    release(done);
    await first;
    await t.ticker.tick();
    expect(t.runtime.requests).toHaveLength(1);
  });
});
