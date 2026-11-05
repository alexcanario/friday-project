import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createResultStore, createRunLookup } from "../src/index.ts";
import type { FridayDatabase } from "../src/sqlite/database.ts";
import { runResults, runs } from "../src/sqlite/schema.ts";
import { openWithProjects } from "./sqlite-fixtures.ts";

const QA_OK = {
  verdict: "pass",
  criteria: [{ index: 1, result: "pass", how: "pnpm test saiu 0", screenshots: [] }],
  notChecked: [],
};
const WORK_OK = { summary: "feito", headSha: "a".repeat(40), changedFiles: [], notDone: [] };

let db: FridayDatabase;
beforeEach(() => {
  db = openWithProjects("p1");
  db.orm
    .insert(runs)
    .values([
      { id: "r1", projectId: "p1", issueId: 1, finishedAt: null },
      { id: "r2", projectId: "p1", issueId: 2, finishedAt: "2026-11-05T00:00:00Z" },
    ])
    .run();
});
afterEach(() => db.close());

describe("createResultStore", () => {
  it("records a result with the project of the run and answers has", () => {
    const store = createResultStore(db);
    expect(store.has("r1", "qaReport")).toBe(false);
    store.record("r1", "qaReport", QA_OK);
    expect(store.has("r1", "qaReport")).toBe(true);
    const rows = db.orm.select().from(runResults).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      runId: "r1",
      kind: "qaReport",
      projectId: "p1",
      valueJson: JSON.stringify(QA_OK),
    });
    expect(store.has("r1", "workReport")).toBe(false);
    expect(store.has("r2", "qaReport")).toBe(false);
  });

  it("refuses a second record of the same run and kind", () => {
    const store = createResultStore(db);
    store.record("r1", "qaReport", QA_OK);
    expect(() => store.record("r1", "qaReport", QA_OK)).toThrow();
    expect(db.orm.select().from(runResults).all()).toHaveLength(1);
    store.record("r1", "workReport", WORK_OK);
    expect(db.orm.select().from(runResults).all()).toHaveLength(2);
    expect(() => store.record("nope", "qaReport", QA_OK)).toThrow();
    expect(db.orm.select().from(runResults).all()).toHaveLength(2);
  });

  it("is exported by the package index", () => {
    expect(typeof createRunLookup).toBe("function");
    expect(typeof createResultStore).toBe("function");
  });
});
