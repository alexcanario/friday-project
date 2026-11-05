import { afterEach, describe, expect, it } from "vitest";
import { createRunRepository } from "../src/index.ts";
import type { FridayDatabase } from "../src/sqlite/database.ts";
import { openWithProjects } from "./sqlite-fixtures.ts";

let db: FridayDatabase;
afterEach(() => db.close());

describe("sqlite run repository", () => {
  it("stores the pack phase of a run", () => {
    db = openWithProjects("a");
    const repo = createRunRepository(db);
    const base = { projectId: "a", issueId: 1, startedAt: null, finishedAt: null };
    repo.save({ ...base, id: "r1", phase: "implement" });
    repo.save({ ...base, id: "r2", phase: null });
    expect(repo.get("r1")).toEqual({ ...base, id: "r1", phase: "implement" });
    expect(repo.get("r2")).toEqual({ ...base, id: "r2", phase: null });
    expect(repo.get("missing")).toBeNull();
  });
});
