import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunLookup } from "../src/index.ts";
import type { FridayDatabase } from "../src/sqlite/database.ts";
import { runs } from "../src/sqlite/schema.ts";
import { openWithProjects } from "./sqlite-fixtures.ts";

const FINISHED = "2026-11-05T00:00:00Z";

let db: FridayDatabase;
beforeEach(() => {
  db = openWithProjects("p1");
  db.orm
    .insert(runs)
    .values([
      { id: "r1", projectId: "p1", issueId: 1, status: "running", finishedAt: null },
      { id: "r2", projectId: "p1", issueId: 2, status: "running", finishedAt: FINISHED },
      {
        id: "r3",
        projectId: "p1",
        issueId: 3,
        status: "canceled_by_reconciliation",
        finishedAt: null,
      },
      { id: "r4", projectId: "p1", issueId: 4, status: "succeeded", finishedAt: null },
    ])
    .run();
});
afterEach(() => db.close());

describe("createRunLookup", () => {
  it("reports active only for a running run without finished_at", () => {
    const lookup = createRunLookup(db);
    expect(lookup.isActive("r1")).toBe(true);
    expect(lookup.isActive("r2")).toBe(false);
    expect(lookup.isActive("r3")).toBe(false);
    expect(lookup.isActive("r4")).toBe(false);
    expect(lookup.isActive("nope")).toBe(false);
  });
});
