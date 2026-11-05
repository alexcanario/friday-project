import { describe, expect, it } from "vitest";
import { TICK_INTERVAL_MS, createTicker, type TickConfig } from "../src/index.ts";
import { FakeClock, FakeEvents, FakeIssues, PendingRuntime, fakeRequest } from "./fakes.ts";
import type { RunResult } from "./fakes.ts";

const done = {} as RunResult;

function setup(config: () => TickConfig | null = () => ({ enabled: true, maxConcurrentRuns: 1 })) {
  const clock = new FakeClock();
  const issues = new FakeIssues();
  const runtime = new PendingRuntime();
  const events = new FakeEvents();
  const built: number[] = [];
  const ticker = createTicker({
    projectId: "p1",
    clock,
    readConfig: config,
    issues,
    buildRequest: (id) => {
      built.push(id);
      return fakeRequest(id);
    },
    runtime,
    events,
  });
  return { clock, issues, runtime, events, built, ticker };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("ticker", () => {
  it("dispatches nothing when enabled is false and one run when true", async () => {
    const off = setup(() => ({ enabled: false, maxConcurrentRuns: 1 }));
    off.issues.ready = [5];
    await off.ticker.tick();
    expect(off.runtime.requests).toHaveLength(0);
    expect(off.events.appended).toHaveLength(0);
    const on = setup();
    on.issues.ready = [5];
    await on.ticker.tick();
    expect(on.runtime.requests).toHaveLength(1);
    expect(on.events.appended).toHaveLength(1);
    expect(on.events.appended[0]).toMatchObject({
      type: "RunDispatched",
      issueId: 5,
      actor: "daemon",
      runId: null,
      projectId: "p1",
    });
  });

  it("rereads enabled on every tick", async () => {
    let enabled = true;
    const s = setup(() => ({ enabled, maxConcurrentRuns: 1 }));
    s.issues.ready = [1];
    await s.ticker.tick();
    s.runtime.resolveAll(done);
    await s.ticker.idle();
    enabled = false;
    s.issues.ready = [2];
    await s.ticker.tick();
    expect(s.runtime.requests).toHaveLength(1);
  });

  it("does nothing when the config is invalid", async () => {
    const s = setup(() => null);
    s.issues.ready = [1];
    await expect(s.ticker.tick()).resolves.toBeUndefined();
    expect(s.runtime.requests).toHaveLength(0);
    expect(s.events.appended).toHaveLength(0);
  });

  it("never starts a second run for an issue with an active run", async () => {
    const s = setup();
    s.issues.ready = [7];
    await s.ticker.tick();
    await s.ticker.tick();
    expect(s.runtime.requests).toHaveLength(1);
    expect(s.built).toEqual([7]);
    s.runtime.resolveAll(done);
    await s.ticker.idle();
    await s.ticker.tick();
    expect(s.runtime.requests).toHaveLength(2);
  });

  it("respects the concurrency limit, frees the slot when a run rejects and survives a listReady error", async () => {
    const two = setup(() => ({ enabled: true, maxConcurrentRuns: 2 }));
    two.issues.ready = [1, 2, 3];
    await two.ticker.tick();
    expect(two.built).toEqual([1, 2]);
    await two.ticker.tick();
    expect(two.runtime.requests).toHaveLength(2);

    const one = setup();
    one.issues.ready = [1, 2, 3];
    await one.ticker.tick();
    expect(one.built).toEqual([1]);
    one.runtime.rejectAll(new Error("boom"));
    await one.ticker.idle();
    await one.ticker.tick();
    expect(one.built).toEqual([1, 1]);

    const s = setup();
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      s.issues.failure = new Error("github down");
      const stop = s.ticker.start();
      s.clock.advance(TICK_INTERVAL_MS);
      await flush();
      expect(s.runtime.requests).toHaveLength(0);
      expect(unhandled).toEqual([]);
      s.issues.failure = null;
      s.issues.ready = [9];
      s.clock.advance(TICK_INTERVAL_MS);
      await flush();
      expect(s.runtime.requests).toHaveLength(1);
      stop();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("ticks every 30000 ms", async () => {
    expect(TICK_INTERVAL_MS).toBe(30000);
    const s = setup();
    const stop = s.ticker.start();
    await flush();
    expect(s.issues.calls).toBe(1);
    s.clock.advance(29999);
    await flush();
    expect(s.issues.calls).toBe(1);
    s.clock.advance(1);
    await flush();
    expect(s.issues.calls).toBe(2);
    stop();
    s.clock.advance(30000);
    await flush();
    expect(s.issues.calls).toBe(2);
  });
});
