import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BreakerState, BreakerStateRepository } from "@friday/application";
import { createBreakerStateRepository, openDatabase } from "@friday/infrastructure";
import { describe, expect, it } from "vitest";
import { createBreaker } from "../src/index.ts";
import { FakeClock } from "./fakes.ts";

const T0 = Date.parse("2026-11-07T10:00:00.000Z");
const MIN = 60000;
const at = (minutes: number) => new Date(T0 + minutes * MIN).toISOString();

function setup(store?: BreakerStateRepository) {
  const clock = new FakeClock();
  clock.advance(T0);
  const make = (s = store) =>
    createBreaker({
      now: () => new Date(clock.now()),
      threshold: 3,
      windowMs: 900000,
      openMs: 1800000,
      ...(s ? { persist: { store: s, projectId: "p" } } : {}),
    });
  return { clock, breaker: make(), make };
}

class SpyStore implements BreakerStateRepository {
  saves: BreakerState[] = [];
  initial: BreakerState | null = null;
  failSave: Error | null = null;
  get(): BreakerState | null {
    return this.initial;
  }
  save(_projectId: string, state: BreakerState): void {
    if (this.failSave) throw this.failSave;
    this.saves.push({ ...state, failures: [...state.failures] });
  }
}

describe("breaker window", () => {
  it("opens after 3 failures in 15 minutes and not before", () => {
    const t = setup();
    expect(t.breaker.isOpen()).toBe(false);
    t.breaker.recordFailure();
    t.clock.advance(5 * MIN);
    t.breaker.recordFailure();
    expect(t.breaker.isOpen()).toBe(false);
    t.clock.advance(5 * MIN);
    t.breaker.recordFailure();
    expect(t.breaker.isOpen()).toBe(true);
    const slow = setup();
    slow.breaker.recordFailure();
    slow.clock.advance(8 * MIN);
    slow.breaker.recordFailure();
    slow.clock.advance(8 * MIN);
    slow.breaker.recordFailure();
    expect(slow.breaker.isOpen()).toBe(false);
  });

  it("counts a failure exactly at the window edge", () => {
    const edge = setup();
    edge.breaker.recordFailure();
    edge.clock.advance(10 * MIN);
    edge.breaker.recordFailure();
    edge.clock.advance(5 * MIN);
    edge.breaker.recordFailure();
    expect(edge.breaker.isOpen()).toBe(true);
    const late = setup();
    late.breaker.recordFailure();
    late.clock.advance(10 * MIN);
    late.breaker.recordFailure();
    late.clock.advance(5 * MIN + 1);
    late.breaker.recordFailure();
    expect(late.breaker.isOpen()).toBe(false);
  });
});

function openAt10(t: ReturnType<typeof setup>) {
  for (let i = 0; i < 3; i++) t.breaker.recordFailure();
}

describe("breaker open period", () => {
  it("stays open for 30 minutes and needs 3 new failures to reopen", () => {
    const t = setup();
    openAt10(t);
    t.clock.advance(30 * MIN - 1);
    expect(t.breaker.isOpen()).toBe(true);
    t.clock.advance(1);
    expect(t.breaker.isOpen()).toBe(false);
    t.clock.advance(MIN);
    t.breaker.recordFailure();
    expect(t.breaker.isOpen()).toBe(false);
    t.clock.advance(MIN);
    t.breaker.recordFailure();
    expect(t.breaker.isOpen()).toBe(false);
    t.clock.advance(MIN);
    t.breaker.recordFailure();
    expect(t.breaker.isOpen()).toBe(true);
  });

  it("ignores failures while open", () => {
    const t = setup();
    openAt10(t);
    t.clock.advance(20 * MIN);
    t.breaker.recordFailure();
    t.clock.advance(10 * MIN);
    expect(t.breaker.isOpen()).toBe(false);
  });
});

describe("breaker persistence", () => {
  it("saves on each failure, on open and on close, and stays closed-safe when save throws", () => {
    const store = new SpyStore();
    const t = setup(store);
    t.breaker.recordFailure();
    expect(store.saves.at(-1)).toEqual({ openedAt: null, failures: [at(0)] });
    t.clock.advance(5 * MIN);
    t.breaker.recordFailure();
    t.clock.advance(5 * MIN);
    t.breaker.recordFailure();
    expect(store.saves.at(-1)).toEqual({ openedAt: at(10), failures: [] });
    const count = store.saves.length;
    t.breaker.isOpen();
    t.breaker.recordFailure();
    expect(store.saves).toHaveLength(count);
    t.clock.advance(30 * MIN);
    expect(t.breaker.isOpen()).toBe(false);
    expect(store.saves.at(-1)).toEqual({ openedAt: null, failures: [] });
    const after = store.saves.length;
    t.breaker.isOpen();
    expect(store.saves).toHaveLength(after);

    const failing = new SpyStore();
    const f = setup(failing);
    f.breaker.recordFailure();
    f.breaker.recordFailure();
    failing.failSave = new Error("disk");
    expect(() => f.breaker.recordFailure()).toThrow("disk");
    expect(f.breaker.isOpen()).toBe(true);
    f.clock.advance(30 * MIN);
    expect(() => f.breaker.isOpen()).toThrow("disk");
    failing.failSave = null;
    expect(f.breaker.isOpen()).toBe(false);
    expect(failing.saves.at(-1)).toEqual({ openedAt: null, failures: [] });
  });

  it("recreated breaker keeps refusing until 10:30", () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), "friday-breaker-")), "friday.db"));
    db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p')").run();
    const store = createBreakerStateRepository(db);
    const t = setup(store);
    openAt10(t);
    t.clock.advance(10 * MIN);
    const again = t.make();
    t.clock.advance(19 * MIN);
    expect(again.isOpen()).toBe(true);
    t.clock.advance(MIN);
    expect(again.isOpen()).toBe(false);

    db.sqlite.prepare("DELETE FROM breaker_state").run();
    const partial = setup(store);
    partial.breaker.recordFailure();
    partial.clock.advance(MIN);
    partial.breaker.recordFailure();
    const resumed = partial.make();
    partial.clock.advance(MIN);
    resumed.recordFailure();
    expect(resumed.isOpen()).toBe(true);

    db.sqlite.prepare("DELETE FROM breaker_state").run();
    expect(setup(store).make().isOpen()).toBe(false);
    db.close();
  });
});
