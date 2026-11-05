import type { RunRecord } from "@friday/application";
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

const KEYS = ["finishedAt", "id", "issueId", "phase", "startedAt", "status"];

describe("GET /runs", () => {
  it("lists runs of one project with status, returns one run, 404 for unknown id or another project and 400 without project", async () => {
    f = openFixture();
    f.deps.runs.save(run("r3", "p1", "2026-11-05T02:00:00Z"));
    f.deps.runs.save(run("r2", "p1", "2026-11-05T01:00:00Z"));
    f.deps.runs.save(run("r1", "p1", null));
    f.deps.runs.save(run("rx", "p2", "2026-11-05T01:00:00Z"));
    const app = await buildApp(f.deps);

    const res = await app.inject({ method: "GET", url: "/runs?project=p1" });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<Record<string, unknown>>>();
    expect(body.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
    for (const item of body) expect(Object.keys(item).sort()).toEqual(KEYS);
    expect(body[1]).toEqual({
      id: "r2",
      issueId: 14,
      phase: "implement",
      status: "running",
      startedAt: "2026-11-05T01:00:00Z",
      finishedAt: null,
    });

    const one = await app.inject({ method: "GET", url: "/runs/r2?project=p1" });
    expect(one.statusCode).toBe(200);
    expect(Object.keys(one.json()).sort()).toEqual(KEYS);
    expect(one.json().id).toBe("r2");

    expect((await app.inject({ method: "GET", url: "/runs/nope?project=p1" })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ method: "GET", url: "/runs/rx?project=p1" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/runs" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/runs/r2" })).statusCode).toBe(400);
    await app.close();
  });
});
