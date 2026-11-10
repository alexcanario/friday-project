import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TICK_INTERVAL_MS, createTicker, type ReadyIssueSource } from "../src/index.ts";
import { FakeClock, FakeEvents, PendingRuntime, fakeRequest } from "./fakes.ts";

type Capacity = { active: number; max: number } | undefined;

/** A ReadyIssueSource whose listReady calls stay pending until the test settles them. */
class PendingIssues implements ReadyIssueSource {
  readonly capacities: Capacity[] = [];
  readonly #settlers: { resolve: (ids: number[]) => void; reject: (e: Error) => void }[] = [];
  #busy = 0;

  get calls(): number {
    return this.capacities.length;
  }

  busy(): number {
    return this.#busy;
  }

  incrementBusy(): void {
    this.#busy += 1;
  }

  listReady(capacity?: { active: number; max: number }): Promise<number[]> {
    this.capacities.push(capacity);
    return new Promise<number[]>((resolve, reject) => {
      this.#settlers.push({ resolve, reject });
    });
  }

  resolveCall(index: number, ids: number[]): void {
    this.#settlers[index]?.resolve(ids);
  }

  rejectCall(index: number, error: Error): void {
    this.#settlers[index]?.reject(error);
  }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function setup(maxConcurrentRuns = 1) {
  const clock = new FakeClock();
  const issues = new PendingIssues();
  const runtime = new PendingRuntime();
  const events = new FakeEvents();
  const built: number[] = [];
  const logs: string[] = [];
  const state = { buildRequest: (id: number) => fakeRequest(id) };
  const ticker = createTicker({
    projectId: "p1",
    clock,
    readConfig: () => ({ enabled: true, maxConcurrentRuns, perIssueUsd: 5, perDayUsd: 10 }),
    issues,
    buildRequest: (id) => {
      built.push(id);
      return state.buildRequest(id);
    },
    runtime,
    events,
    log: (message) => logs.push(message),
  });
  return { clock, issues, runtime, built, logs, ticker, state };
}

describe("ticker overlap", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    unhandled.length = 0;
    process.on("unhandledRejection", onUnhandled);
  });

  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
  });

  it("skips scheduled ticks while listReady is pending", () => {
    const { clock, issues, ticker } = setup();
    ticker.start();
    clock.advance(TICK_INTERVAL_MS);
    clock.advance(TICK_INTERVAL_MS);
    expect(issues.calls).toBe(1);
  });

  it("runs the next tick after the previous one settles", async () => {
    const { clock, issues, ticker } = setup();
    ticker.start();
    clock.advance(TICK_INTERVAL_MS);
    expect(issues.calls).toBe(1);
    issues.resolveCall(0, []);
    await flush();
    clock.advance(TICK_INTERVAL_MS);
    expect(issues.calls).toBe(2);
  });

  it("releases the in-flight flag when listReady rejects", async () => {
    const { clock, issues, ticker } = setup();
    ticker.start();
    issues.rejectCall(0, new Error("github fora do ar"));
    await flush();
    clock.advance(TICK_INTERVAL_MS);
    expect(issues.calls).toBe(2);
    await flush();
    expect(unhandled).toEqual([]);
  });

  it("consumes the ready list once and logs no dispatch failure with slow listReady", async () => {
    const { clock, issues, runtime, built, logs, ticker, state } = setup();
    let consumed = 0;
    state.buildRequest = (id) => {
      if (issues.calls > consumed + 1) throw new Error(`issue ${id} não foi despachada por estado`);
      return fakeRequest(id);
    };
    ticker.start();
    clock.advance(TICK_INTERVAL_MS);
    clock.advance(TICK_INTERVAL_MS);
    expect(issues.calls).toBe(1);
    issues.resolveCall(consumed, [5]);
    await flush();
    expect(built).toEqual([5]);
    expect(runtime.requests).toHaveLength(1);
    expect(logs).toEqual([]);
  });

  it("never exceeds max_concurrent_runs with overlapping ticks and the Judge", async () => {
    const { clock, issues, runtime, ticker } = setup(1);
    const occupied = () => runtime.requests.length + issues.busy();
    ticker.start();
    clock.advance(TICK_INTERVAL_MS);
    const settle = async (index: number) => {
      if (index === 0) {
        issues.resolveCall(index, [5]);
      } else {
        const capacity = issues.capacities[index];
        if (capacity && capacity.active + issues.busy() < capacity.max) issues.incrementBusy();
        issues.resolveCall(index, []);
      }
      await flush();
      expect(occupied()).toBeLessThanOrEqual(1);
    };
    await settle(0);
    clock.advance(TICK_INTERVAL_MS);
    if (issues.calls > 1) await settle(1);
    if (issues.calls > 2) await settle(2);
    expect(occupied()).toBeLessThanOrEqual(1);
  });

  it("direct tick() calls are not serialized", async () => {
    const { issues, ticker } = setup();
    const first = ticker.tick();
    const second = ticker.tick();
    expect(issues.calls).toBe(2);
    issues.resolveCall(0, []);
    issues.resolveCall(1, []);
    await Promise.all([first, second]);
  });
});
