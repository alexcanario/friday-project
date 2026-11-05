import { afterEach, describe, expect, it } from "vitest";
import { createEventStore, createIssueRepository } from "../src/index.ts";
import type { FridayDatabase } from "../src/sqlite/database.ts";
import { openWithProjects } from "./sqlite-fixtures.ts";

let db: FridayDatabase;
afterEach(() => db.close());

const changed = (projectId: string, issueId: number, to: string, counters: number) => ({
  projectId,
  issueId,
  runId: null,
  type: "StateChanged",
  payload: {
    type: "StateChanged",
    issueId: String(issueId),
    from: "Todo",
    to,
    trigger: "Admitted",
    heldReason: to === "Held" ? "budget" : null,
    verifyRound: counters,
    qaRound: counters + 1,
    reviewIter: counters + 2,
  },
  actor: "test",
  at: "2026-01-01T00:00:00Z",
});

const rows = (projectId: string) =>
  db.sqlite
    .prepare(
      "SELECT id, state, held_reason, verify_round, qa_round, review_iter FROM issues WHERE project_id = ? ORDER BY id",
    )
    .all(projectId);

describe("sqlite issue projection", () => {
  it("rebuilds the issues projection from events", () => {
    db = openWithProjects("a", "b");
    const store = createEventStore(db);
    const repo = createIssueRepository(db);
    store.append(changed("a", 1, "InProgress", 0));
    store.append(changed("a", 1, "Held", 1));
    store.append(changed("a", 2, "Verify", 2));
    store.append(changed("b", 1, "Done", 5));
    repo.rebuild("a");
    repo.rebuild("b");
    const before = rows("a");
    const otherBefore = rows("b");
    expect(before).toHaveLength(2);
    expect(before[0]).toMatchObject({
      state: "Held",
      held_reason: "budget",
      verify_round: 1,
      qa_round: 2,
      review_iter: 3,
    });
    db.sqlite.prepare("DELETE FROM issues WHERE project_id = 'a'").run();
    expect(rows("a")).toHaveLength(0);
    repo.rebuild("a");
    expect(rows("a")).toEqual(before);
    expect(rows("b")).toEqual(otherBefore);
    expect(repo.get("a", 1)?.state).toBe("Held");
    expect(repo.get("a", 99)).toBeNull();
  });
});
