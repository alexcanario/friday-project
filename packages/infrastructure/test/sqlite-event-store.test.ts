import { afterEach, describe, expect, it } from "vitest";
import { createEventStore } from "../src/index.ts";
import type { FridayDatabase } from "../src/sqlite/database.ts";
import { openWithProjects } from "./sqlite-fixtures.ts";

let db: FridayDatabase;
afterEach(() => db.close());

const ev = (projectId: string, issueId: number, type = "Note") => ({
  projectId,
  issueId,
  runId: null,
  type,
  payload: { n: issueId },
  actor: "test",
  at: "2026-01-01T00:00:00Z",
});

describe("sqlite event store", () => {
  it("appends events with increasing seq and exposes no update or delete", () => {
    db = openWithProjects("a");
    const store = createEventStore(db);
    const first = store.append(ev("a", 1));
    const second = store.append(ev("a", 1));
    expect(second.seq).toBeGreaterThan(first.seq);
    expect(store.list("a", 1).map((e) => e.seq)).toEqual([first.seq, second.seq]);
    expect(store.list("a", 1)[0]?.payload).toEqual({ n: 1 });
    expect(Object.keys(store).sort()).toEqual(["append", "list"]);
    expect("update" in store).toBe(false);
    expect("delete" in store).toBe(false);
  });

  it("isolates events by project", () => {
    db = openWithProjects("a", "b");
    const store = createEventStore(db);
    store.append(ev("a", 1));
    store.append(ev("b", 1));
    expect(store.list("a", 1)).toHaveLength(1);
    expect(store.list("a", 1)[0]?.projectId).toBe("a");
    expect(store.list("b", 1)[0]?.projectId).toBe("b");
  });
});
