import { describe, expect, it } from "vitest";
import { createEventStore, createUnitOfWork } from "../src/index.ts";
import { openWithProjects } from "./sqlite-fixtures.ts";

const count = (db: ReturnType<typeof openWithProjects>, table: string): number =>
  (db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

const insertApproval = (db: ReturnType<typeof openWithProjects>) =>
  db.sqlite
    .prepare(
      `INSERT INTO approvals (id, project_id, issue_id, pr, head_sha, tier, requested_at, expires_at)
       VALUES ('00000001', 'p', 1, 2, ?, 'high', 1, 2)`,
    )
    .run("a".repeat(40));

describe("sqlite unit of work", () => {
  it("commits on success and rolls back on throw", () => {
    const db = openWithProjects("p");
    const events = createEventStore(db);
    const uow = createUnitOfWork(db);
    const append = () =>
      events.append({
        projectId: "p",
        issueId: 1,
        runId: null,
        type: "X",
        payload: {},
        actor: "t",
        at: "2026-11-06T00:00:00Z",
      });

    const value = uow.run(() => {
      insertApproval(db);
      append();
      return 42;
    });
    expect(value).toBe(42);
    expect(count(db, "approvals")).toBe(1);
    expect(count(db, "events")).toBe(1);
    expect(db.sqlite.inTransaction).toBe(false);

    const boom = new Error("boom");
    expect(() =>
      uow.run(() => {
        db.sqlite.prepare("DELETE FROM approvals").run();
        append();
        throw boom;
      }),
    ).toThrow(boom);
    expect(count(db, "approvals")).toBe(1);
    expect(count(db, "events")).toBe(1);
    expect(db.sqlite.inTransaction).toBe(false);
  });
});
