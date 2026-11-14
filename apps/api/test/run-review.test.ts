import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { countRows, openFixture, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

const AT = "2026-11-05T10:00:00.000Z";

function addRun(id: string, projectId = "p1", issueId = 14): void {
  f.deps.runs.save({
    id,
    projectId,
    issueId,
    phase: "judge",
    startedAt: AT,
    finishedAt: null,
    status: "running",
  });
}

function addEvent(
  type: string,
  runId: string | null,
  payload: unknown,
  at = AT,
  projectId = "p1",
): void {
  f.deps.events.append({ projectId, issueId: 14, runId, type, payload, actor: "daemon", at });
}

const get = async (url: string) => {
  const app = await buildApp(f.deps);
  const res = await app.inject({ method: "GET", url });
  await app.close();
  return res;
};

describe("GET /runs/:runId/review", () => {
  it("returns the judge verdict and the PR number of the run", async () => {
    f = openFixture();
    addRun("r1");
    addEvent("PrOpened", "r0", { number: 7 });
    addEvent(
      "JudgeFinished",
      "r1",
      { outcome: "approve", reviewId: 501 },
      "2026-11-05T11:00:00.000Z",
    );
    const res = await get("/runs/r1/review?project=p1");
    expect(res.statusCode).toBe(200);
    const body = res.json<{ judge: Record<string, unknown>; pr: Record<string, unknown> }>();
    expect(body.judge).toMatchObject({ outcome: "approve", reviewId: 501, feedback: null });
    expect(body.judge.at).toBe("2026-11-05T11:00:00.000Z");
    expect(body.pr).toMatchObject({ number: 7 });
    expect(Object.keys(body.pr)).toEqual(["number"]);
  });

  it("returns the feedback of changes_requested", async () => {
    f = openFixture();
    addRun("r1");
    addEvent("JudgeFinished", "r1", {
      outcome: "changes_requested",
      feedback: "1. x",
      reviewId: 501,
    });
    const body = (await get("/runs/r1/review?project=p1")).json<{ judge: unknown }>();
    expect(body.judge).toMatchObject({ outcome: "changes_requested", feedback: "1. x" });
  });

  it("uses the latest valid JudgeFinished of the same run only", async () => {
    f = openFixture();
    addRun("r1");
    addRun("r2");
    addEvent("JudgeFinished", "r1", { outcome: "reject", reviewId: 1 }, "2026-11-05T10:01:00.000Z");
    addEvent(
      "JudgeFinished",
      "r1",
      { outcome: "approve", reviewId: 2 },
      "2026-11-05T10:02:00.000Z",
    );
    addEvent("JudgeFinished", "r2", { outcome: "reject", reviewId: 3 }, "2026-11-05T10:03:00.000Z");
    addEvent("JudgeFinished", "r1", { outcome: "x", reviewId: 4 }, "2026-11-05T10:04:00.000Z");
    addEvent(
      "JudgeFinished",
      "r1",
      { outcome: "approve", reviewId: 1.5 },
      "2026-11-05T10:05:00.000Z",
    );
    const body = (await get("/runs/r1/review?project=p1")).json<{ judge: unknown }>();
    expect(body.judge).toEqual({
      outcome: "approve",
      reviewId: 2,
      feedback: null,
      at: "2026-11-05T10:02:00.000Z",
    });
  });

  it("returns nulls without events and ignores invalid PrOpened numbers", async () => {
    f = openFixture();
    addRun("r1");
    const empty = await get("/runs/r1/review?project=p1");
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ judge: null, pr: null });

    addEvent("PrOpened", "r0", { number: 0 });
    expect((await get("/runs/r1/review?project=p1")).json()).toEqual({ judge: null, pr: null });
    addEvent("PrOpened", "r9", { number: 7 });
    for (const number of [0, -1, 1.5, "7"]) addEvent("PrOpened", "r1", { number });
    expect((await get("/runs/r1/review?project=p1")).json()).toEqual({
      judge: null,
      pr: { number: 7 },
    });
  });

  it("returns 404 for unknown run or other project and 400 without project", async () => {
    f = openFixture();
    addRun("r1");
    addRun("rx", "p2");
    for (const url of ["/runs/nope/review?project=p1", "/runs/rx/review?project=p1"]) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.json()).toEqual({ message: "Run não encontrada." });
    }
    expect((await get("/runs/r1/review")).statusCode).toBe(400);
  });

  it("is read-only", async () => {
    f = openFixture();
    addRun("r1");
    addEvent("JudgeFinished", "r1", { outcome: "approve", reviewId: 501 });
    const app = await buildApp(f.deps);
    const eventsBefore = f.deps.events.list("p1", 14);
    const runsBefore = f.deps.runs.list("p1");
    const countsBefore = countRows(f.db);
    await app.inject({ method: "GET", url: "/runs/r1/review?project=p1" });
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const res = await app.inject({
        method,
        url: "/runs/r1/review?project=p1",
        payload: method === "DELETE" ? undefined : {},
      });
      expect(res.statusCode, method).toBe(404);
    }
    expect(f.deps.events.list("p1", 14)).toEqual(eventsBefore);
    expect(f.deps.runs.list("p1")).toEqual(runsBefore);
    expect(countRows(f.db)).toEqual(countsBefore);
    await app.close();
  });
});
