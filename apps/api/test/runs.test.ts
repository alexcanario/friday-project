import type { LedgerEntry, RunRecord } from "@friday/application";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { openFixture, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

const run = (id: string, projectId: string, startedAt: string | null): RunRecord => ({
  id,
  projectId,
  issueId: 14,
  phase: "implement",
  startedAt,
  finishedAt: null,
  status: "running",
});

const KEYS = ["id", "issueId", "phase", "status", "startedAt", "finishedAt", "costUsd", "numTurns"];

const ledgerEntry = (
  runId: string,
  costUsd: number | null,
  numTurns: number | null,
): LedgerEntry => ({
  projectId: "p1",
  runId,
  day: "2026-11-05",
  costUsd,
  costUnknown: costUsd === null,
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  issueId: 14,
  numTurns,
});

function seed(f: Fixture): void {
  f.deps.runs.save(run("r3", "p1", "2026-11-05T02:00:00Z"));
  f.deps.runs.save(run("r2", "p1", "2026-11-05T01:00:00Z"));
  f.deps.runs.save(run("r1", "p1", null));
  f.deps.runs.save(run("r4", "p1", "2026-11-05T03:00:00Z"));
  f.deps.runs.save(run("rx", "p2", "2026-11-05T01:00:00Z"));
  f.deps.ledger.record(ledgerEntry("r2", 0.5, 3));
  f.deps.ledger.record(ledgerEntry("r3", 0.25, 2));
  f.deps.ledger.record(ledgerEntry("r3", 0.5, 3));
  f.deps.ledger.record(ledgerEntry("r4", null, 1));
}

describe("GET /runs", () => {
  it("lists runs of one project with status, cost and turns", async () => {
    f = openFixture();
    seed(f);
    const app = await buildApp(f.deps);

    const res = await app.inject({ method: "GET", url: "/runs?project=p1" });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<Record<string, unknown>>>();
    expect(body.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4"]);
    for (const item of body) expect(Object.keys(item)).toEqual(expect.arrayContaining(KEYS));
    expect(body[0]).toMatchObject({ costUsd: null, numTurns: null });
    expect(body[1]).toMatchObject({
      id: "r2",
      issueId: 14,
      phase: "implement",
      status: "running",
      startedAt: "2026-11-05T01:00:00Z",
      finishedAt: null,
      costUsd: 0.5,
      numTurns: 3,
    });
    expect(body[2]).toMatchObject({ costUsd: 0.75, numTurns: 5 });
    expect(body[3]).toMatchObject({ costUsd: null, numTurns: 1 });
    await app.close();
  });

  it("returns one run with cost and turns, 404 for unknown id or another project and 400 without project", async () => {
    f = openFixture();
    seed(f);
    const app = await buildApp(f.deps);

    const one = await app.inject({ method: "GET", url: "/runs/r3?project=p1" });
    expect(one.statusCode).toBe(200);
    expect(Object.keys(one.json())).toEqual(expect.arrayContaining(KEYS));
    expect(one.json()).toMatchObject({ id: "r3", costUsd: 0.75, numTurns: 5 });
    const none = await app.inject({ method: "GET", url: "/runs/r1?project=p1" });
    expect(none.json()).toMatchObject({ costUsd: null, numTurns: null });

    expect((await app.inject({ method: "GET", url: "/runs/nope?project=p1" })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ method: "GET", url: "/runs/rx?project=p1" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/runs" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/runs/r2" })).statusCode).toBe(400);
    await app.close();
  });
});
