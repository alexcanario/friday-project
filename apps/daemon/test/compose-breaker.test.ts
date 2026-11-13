import { existsSync, mkdtempSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHubPort, WorktreeManager } from "@friday/application";
import { openDatabase } from "@friday/infrastructure";
import { describe, expect, it, vi } from "vitest";
import type { TickerDeps } from "../src/tick.ts";
import { composeDaemon, type ComposeOptions } from "../src/index.ts";
import { FakeClock, FakeGitHub, PendingRuntime } from "./fakes.ts";

const captured = vi.hoisted(() => ({ deps: [] as unknown[] }));

vi.mock("../src/tick.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/tick.ts")>();
  return {
    ...actual,
    createTicker: vi.fn((deps: TickerDeps) => {
      captured.deps.push(deps);
      return actual.createTicker(deps);
    }),
  };
});

const fixture = join(import.meta.dirname, "../../../packages/infrastructure/test/fixtures/valid");
const T = Date.parse("2026-11-05T03:00:00.000Z");
const MIN = 60000;
const CORRUPT = "O estado do breaker está ilegível ou corrompido.";

function fakeWorktrees(): WorktreeManager {
  const ok = Promise.resolve({ ok: true as const, value: [] });
  return {
    create: vi.fn(),
    remove: vi.fn(() => Promise.resolve({ ok: true as const, value: undefined })),
    list: vi.fn(() => ok),
    listOrphans: vi.fn(() => ok),
    isClean: vi.fn(() => Promise.resolve(true)),
  } as unknown as WorktreeManager;
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "friday-compose-breaker-"));
  cpSync(fixture, root, { recursive: true });
  const file = join(root, "factory.yaml");
  const yaml = readFileSync(file, "utf8");
  writeFileSync(file, yaml);
  const clock = { at: T };
  const opts: ComposeOptions = {
    root,
    repoDir: join(root, "repos", "p__r"),
    dbPath: join(root, "friday.db"),
    projectId: "p",
    env: { FRIDAY_AUTHOR_TOKEN: "t0k3n" },
    worktrees: fakeWorktrees(),
    runtime: new PendingRuntime(),
    prOf: () => null,
    clock: new FakeClock(),
    lock: { pid: 101, kill: () => undefined },
    now: () => new Date(clock.at),
    createGitHub: (() => new FakeGitHub()) as unknown as (
      token: string,
      repo: { owner: string; repo: string },
    ) => GitHubPort,
  };
  captured.deps.length = 0;
  return { root, opts, clock };
}

const last = () => captured.deps.at(-1) as TickerDeps;
const breakerOf = () => last().breaker!;

function seed(dbPath: string, failuresJson: string, openedAt: string | null = null): void {
  const db = openDatabase(dbPath);
  db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p')").run();
  db.sqlite
    .prepare("INSERT INTO breaker_state (project_id, opened_at, failures_json) VALUES ('p', ?, ?)")
    .run(openedAt, failuresJson);
  db.close();
}

describe("composeDaemon breaker", () => {
  it("passes a closed breaker to the ticker", async () => {
    const t = setup();
    const daemon = await composeDaemon(t.opts);
    expect(breakerOf()).toBeDefined();
    expect(breakerOf().recorderDeps.projectId).toBe("p");
    expect(breakerOf().breaker.isOpen()).toBe(false);
    daemon.release();
  });

  it("persists the opening after three failures and not after two", async () => {
    const t = setup();
    const daemon = await composeDaemon(t.opts);
    const { breaker } = breakerOf();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
    const row = daemon.db.sqlite
      .prepare("SELECT opened_at, failures_json FROM breaker_state WHERE project_id = 'p'")
      .get();
    expect(row).toEqual({ opened_at: "2026-11-05T03:00:00.000Z", failures_json: "[]" });
    daemon.release();
  });

  it("counts only failures inside the 15 minute window", async () => {
    const outside = setup();
    const a = await composeDaemon(outside.opts);
    for (const offset of [0, 900001, 900002]) {
      outside.clock.at = T + offset;
      breakerOf().breaker.recordFailure();
    }
    expect(breakerOf().breaker.isOpen()).toBe(false);
    a.release();

    const inside = setup();
    const b = await composeDaemon(inside.opts);
    for (const offset of [0, 450000, 900000]) {
      inside.clock.at = T + offset;
      breakerOf().breaker.recordFailure();
    }
    expect(breakerOf().breaker.isOpen()).toBe(true);
    b.release();
  });

  it("keeps the breaker open across a restart until 30 minutes", async () => {
    const t = setup();
    const first = await composeDaemon(t.opts);
    for (let i = 0; i < 3; i += 1) breakerOf().breaker.recordFailure();
    expect(breakerOf().breaker.isOpen()).toBe(true);
    first.release();

    t.clock.at = T + 30 * MIN - 1;
    const second = await composeDaemon(t.opts);
    expect(breakerOf().breaker.isOpen()).toBe(true);
    second.release();

    t.clock.at = T + 30 * MIN;
    const third = await composeDaemon(t.opts);
    expect(breakerOf().breaker.isOpen()).toBe(false);
    third.release();
  });

  it("fails closed when failures_json is not JSON or not a list", async () => {
    for (const bad of ["{not json", "{}"]) {
      const t = setup();
      seed(t.opts.dbPath, bad);
      await expect(composeDaemon(t.opts)).rejects.toThrow(new Error(CORRUPT));
      expect(captured.deps).toHaveLength(0);
      expect(existsSync(join(t.root, ".friday", "daemon.lock"))).toBe(false);
      expect(() => openDatabase(t.opts.dbPath).close()).not.toThrow();
    }
  });

  it("accepts a valid empty persisted state", async () => {
    const t = setup();
    seed(t.opts.dbPath, "[]");
    const daemon = await composeDaemon(t.opts);
    expect(breakerOf().breaker.isOpen()).toBe(false);
    daemon.release();
  });

  it("fails closed when a persisted timestamp is not ISO", async () => {
    const cases: [string | null, string][] = [
      ["not-a-date", "[]"],
      [null, '["garbage"]'],
      [null, "[1]"],
    ];
    for (const [openedAt, failuresJson] of cases) {
      const t = setup();
      seed(t.opts.dbPath, failuresJson, openedAt);
      await expect(composeDaemon(t.opts)).rejects.toThrow(new Error(CORRUPT));
      expect(captured.deps).toHaveLength(0);
      expect(existsSync(join(t.root, ".friday", "daemon.lock"))).toBe(false);
      expect(() => openDatabase(t.opts.dbPath).close()).not.toThrow();
    }
  });

  it("accepts a valid persisted open state", async () => {
    const t = setup();
    seed(t.opts.dbPath, '["2026-11-05T02:55:00.000Z"]', "2026-11-05T03:00:00.000Z");
    const daemon = await composeDaemon(t.opts);
    expect(breakerOf().breaker.isOpen()).toBe(true);
    daemon.release();
  });
});
