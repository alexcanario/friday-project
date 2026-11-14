import type { LedgerEntry, RunRecord } from "@friday/application";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { openFixture, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

const run = (id: string, projectId: string): RunRecord => ({
  id,
  projectId,
  issueId: 14,
  phase: null,
  startedAt: null,
  finishedAt: null,
  status: "running",
});

const entry = (
  projectId: string,
  runId: string,
  costUsd: number | null,
  issueId: number,
): LedgerEntry => ({
  projectId,
  runId,
  day: "2026-11-05",
  costUsd,
  costUnknown: costUsd === null,
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  issueId,
  numTurns: null,
});

describe("GET /ledger/days/:day", () => {
  it("returns the day sum with unknown-cost flag, ignores other projects and 400 for an invalid day or missing project", async () => {
    f = openFixture();
    for (const [id, p] of [
      ["r1", "p1"],
      ["r2", "p1"],
      ["r3", "p2"],
    ] as const) {
      f.deps.runs.save(run(id, p));
    }
    f.deps.ledger.record(entry("p1", "r1", 0.5, 7));
    f.deps.ledger.record(entry("p1", "r2", null, 7));
    f.deps.ledger.record(entry("p2", "r3", 7, 7));
    const app = await buildApp(f.deps);

    const res = await app.inject({ method: "GET", url: "/ledger/days/2026-11-05?project=p1" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ costUsd: 0.5, anyCostUnknown: true });
    expect(res.json()).toEqual(f.deps.ledger.sumByDay("p1", "2026-11-05"));

    const empty = await app.inject({ method: "GET", url: "/ledger/days/2026-11-06?project=p1" });
    expect(empty.statusCode).toBe(200);
    expect(empty.body).toBe('{"costUsd":0,"anyCostUnknown":false}');

    for (const day of ["2026-13-40", "abc"]) {
      const bad = await app.inject({ method: "GET", url: `/ledger/days/${day}?project=p1` });
      expect(bad.statusCode).toBe(400);
    }
    expect((await app.inject({ method: "GET", url: "/ledger/days/2026-11-05" })).statusCode).toBe(
      400,
    );
    await app.close();
  });
});

describe("GET /ledger/issues/:issueId", () => {
  it("returns the issue sum with unknown-cost flag and ignores other projects", async () => {
    f = openFixture();
    for (const [id, p] of [
      ["r1", "p1"],
      ["r2", "p1"],
      ["r3", "p1"],
      ["r4", "p2"],
    ] as const) {
      f.deps.runs.save(run(id, p));
    }
    f.deps.ledger.record(entry("p1", "r1", 0.75, 14));
    f.deps.ledger.record(entry("p1", "r2", 0.5, 14));
    f.deps.ledger.record(entry("p2", "r4", 9, 14));
    const app = await buildApp(f.deps);

    const res = await app.inject({ method: "GET", url: "/ledger/issues/14?project=p1" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"costUsd":1.25,"anyCostUnknown":false}');

    f.deps.ledger.record(entry("p1", "r3", null, 14));
    const unknown = await app.inject({ method: "GET", url: "/ledger/issues/14?project=p1" });
    expect(unknown.json()).toEqual({ costUsd: 1.25, anyCostUnknown: true });

    const empty = await app.inject({ method: "GET", url: "/ledger/issues/99?project=p1" });
    expect(empty.statusCode).toBe(200);
    expect(empty.body).toBe('{"costUsd":0,"anyCostUnknown":false}');
    await app.close();
  });

  it("returns 400 for an invalid issue id or missing project", async () => {
    f = openFixture();
    const app = await buildApp(f.deps);
    for (const url of [
      "/ledger/issues/abc?project=p1",
      "/ledger/issues/0?project=p1",
      "/ledger/issues/14",
    ]) {
      expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(400);
    }
    await app.close();
  });
});
