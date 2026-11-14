import { afterEach, describe, expect, it } from "vitest";
import { createProjectEnabledRepository, openDatabase } from "@friday/infrastructure";
import { tempDbPath } from "../../../packages/infrastructure/test/sqlite-helpers.ts";
import { createTicker, type TickConfig } from "../src/index.ts";
import { FakeClock, FakeEvents, FakeIssues, PendingRuntime, fakeRequest } from "./fakes.ts";

const open: Array<{ close(): void }> = [];
afterEach(() => open.splice(0).forEach((d) => d.close()));

function setup() {
  const db = openDatabase(tempDbPath());
  open.push(db);
  db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p1')").run();
  const enabled = createProjectEnabledRepository(db);
  const issues = new FakeIssues();
  const state: { config: TickConfig | null } = { config: null };
  const ticker = createTicker({
    projectId: "p1",
    clock: new FakeClock(),
    readConfig: () => state.config,
    issues,
    buildRequest: (id) => fakeRequest(id),
    runtime: new PendingRuntime(),
    events: new FakeEvents(),
    enabled,
  });
  return { enabled, issues, state, ticker };
}

const config = (on: boolean): TickConfig => ({
  enabled: on,
  maxConcurrentRuns: 1,
  perIssueUsd: 5,
  perDayUsd: 10,
});

describe("ticker enabled record", () => {
  it("stores enabled on every tick before the guard and keeps the last value when the config is invalid", async () => {
    const t = setup();
    t.state.config = config(false);
    await t.ticker.tick();
    expect(t.enabled.get("p1")).toBe(false);
    expect(t.issues.calls).toBe(0);
    t.state.config = config(true);
    await t.ticker.tick();
    expect(t.enabled.get("p1")).toBe(true);
    t.state.config = null;
    await expect(t.ticker.tick()).resolves.toBeUndefined();
    expect(t.enabled.get("p1")).toBe(true);
  });

  it("does not store anything when the config is invalid from the start", async () => {
    const t = setup();
    await t.ticker.tick();
    expect(t.enabled.get("p1")).toBeNull();
  });
});
