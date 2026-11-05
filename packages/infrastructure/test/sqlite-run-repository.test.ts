import { afterEach, describe, expect, it } from "vitest";
import type { RunRecord, RunRecordStatus } from "@friday/application";
import { createRunRepository } from "../src/index.ts";
import type { FridayDatabase } from "../src/sqlite/database.ts";
import { openWithProjects } from "./sqlite-fixtures.ts";

let db: FridayDatabase;
afterEach(() => db.close());

describe("sqlite run repository", () => {
  it("stores the pack phase of a run", () => {
    db = openWithProjects("a");
    const repo = createRunRepository(db);
    const base = {
      projectId: "a",
      issueId: 1,
      startedAt: null,
      finishedAt: null,
      status: "running" as const,
    };
    repo.save({ ...base, id: "r1", phase: "implement" });
    repo.save({ ...base, id: "r2", phase: null });
    expect(repo.get("r1")).toEqual({ ...base, id: "r1", phase: "implement" });
    expect(repo.get("r2")).toEqual({ ...base, id: "r2", phase: null });
    expect(repo.get("missing")).toBeNull();
  });

  it("lists only running unfinished runs of the project", () => {
    db = openWithProjects("a", "b");
    const repo = createRunRepository(db);
    const FINISHED = "2026-11-05T00:00:00Z";
    const base = { phase: null, startedAt: null };
    const mk = (
      id: string,
      projectId: string,
      status: RunRecordStatus,
      finishedAt: string | null,
    ) => ({ ...base, id, projectId, issueId: 1, status, finishedAt }) satisfies RunRecord;
    const r1 = mk("r1", "a", "running", null);
    const r4 = mk("r4", "b", "running", null);
    repo.save(r1);
    repo.save(mk("r2", "a", "succeeded", FINISHED));
    repo.save(mk("r3", "a", "canceled_by_reconciliation", FINISHED));
    repo.save(r4);
    repo.save(mk("r5", "a", "running", FINISHED));
    expect(repo.listActive("a")).toEqual([r1]);
    expect(repo.listActive("b")).toEqual([r4]);
    expect(repo.listActive("zzz")).toEqual([]);
  });

  it("stores and updates the run status", () => {
    db = openWithProjects("a");
    const repo = createRunRepository(db);
    const base = { projectId: "a", issueId: 1, phase: null, startedAt: null, finishedAt: null };
    repo.save({ ...base, id: "r1", status: "succeeded" });
    expect(repo.get("r1")?.status).toBe("succeeded");
    repo.save({ ...base, id: "r2", status: "running" });
    const finishedAt = "2026-11-05T03:00:00.000Z";
    repo.save({ ...base, id: "r2", status: "canceled_by_reconciliation", finishedAt });
    expect(repo.get("r2")).toEqual({
      ...base,
      id: "r2",
      status: "canceled_by_reconciliation",
      finishedAt,
    });
    const count = db.sqlite.prepare("SELECT COUNT(*) AS n FROM runs WHERE id = 'r2'").get();
    expect(count).toEqual({ n: 1 });
  });

  it("list returns only the project runs ordered by startedAt then id and [] for an unknown project", () => {
    db = openWithProjects("a", "b");
    const repo = createRunRepository(db);
    const mk = (id: string, projectId: string, startedAt: string | null): RunRecord => ({
      id,
      projectId,
      issueId: 1,
      phase: null,
      startedAt,
      finishedAt: null,
      status: "running",
    });
    const early = "2026-11-05T01:00:00Z";
    const late = "2026-11-05T02:00:00Z";
    repo.save(mk("r5", "a", late));
    repo.save(mk("r3", "a", early));
    repo.save(mk("r2", "a", early));
    repo.save(mk("r9", "a", null));
    repo.save(mk("r1", "a", null));
    repo.save(mk("r4", "b", early));
    expect(repo.list("a").map((r) => r.id)).toEqual(["r1", "r9", "r2", "r3", "r5"]);
    expect(repo.list("b").map((r) => r.id)).toEqual(["r4"]);
    expect(repo.list("desconhecido")).toEqual([]);
  });
});
