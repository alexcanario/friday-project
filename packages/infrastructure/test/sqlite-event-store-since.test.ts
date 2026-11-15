import { afterEach, describe, expect, it } from "vitest";
import { createEventStore } from "../src/index.ts";
import type { FridayDatabase } from "../src/sqlite/database.ts";
import { openWithProjects } from "./sqlite-fixtures.ts";

let db: FridayDatabase;
afterEach(() => db.close());

const ev = (projectId: string, issueId: number) => ({
  projectId,
  issueId,
  runId: null,
  type: "Note",
  payload: { n: issueId },
  actor: "test",
  at: "2026-01-01T00:00:00Z",
});

describe("sqlite event store listSince", () => {
  it("listSince returns only later events of the project in seq order", () => {
    db = openWithProjects("p1", "p2");
    const store = createEventStore(db);
    const a = store.append(ev("p1", 1));
    store.append(ev("p2", 1));
    const b = store.append(ev("p1", 2));
    const c = store.append(ev("p1", 3));
    expect(store.listSince("p1", a.seq).map((e) => e.seq)).toEqual([b.seq, c.seq]);
    expect(store.listSince("p1", 0).map((e) => e.issueId)).toEqual([1, 2, 3]);
    expect(store.listSince("p1", c.seq)).toEqual([]);
    expect(store.listSince("p2", 0).every((e) => e.projectId === "p2")).toBe(true);
  });
});
