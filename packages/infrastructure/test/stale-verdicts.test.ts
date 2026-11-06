import { afterEach, describe, expect, it } from "vitest";
import type { StaleVerdicts } from "@friday/application";
import { SqliteStaleVerdicts, createEventStore } from "../src/index.ts";
import type { FridayDatabase } from "../src/sqlite/database.ts";
import { openWithProjects } from "./sqlite-fixtures.ts";

let db: FridayDatabase;
afterEach(() => db.close());

const A = "a".repeat(40);
const B = "b".repeat(40);
const AT = "2026-11-05T03:00:00.000Z";

function setup() {
  db = openWithProjects("p", "q");
  const events = createEventStore(db);
  return { events, stale: new SqliteStaleVerdicts(events, () => new Date(AT)) };
}
const rows = () =>
  db.sqlite.prepare("SELECT * FROM events WHERE type = 'VerdictInvalidated'").all();

describe("SqliteStaleVerdicts", () => {
  it("markStale records a VerdictInvalidated event and isStale turns true", () => {
    const { stale } = setup();
    expect(stale.isStale("p", 7, A)).toBe(false);
    stale.markStale("p", 7, A);
    expect(stale.isStale("p", 7, A)).toBe(true);
    const all = db.sqlite.prepare("SELECT * FROM events").all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      project_id: "p",
      issue_id: 7,
      run_id: null,
      type: "VerdictInvalidated",
      payload_json: `{"headSha":"${A}"}`,
      actor: "daemon",
      at: AT,
    });
  });

  it("isStale is scoped to project, issue, sha and event type, and markStale does not duplicate", () => {
    const { stale, events } = setup();
    stale.markStale("p", 7, A);
    expect(stale.isStale("p", 8, A)).toBe(false);
    expect(stale.isStale("q", 7, A)).toBe(false);
    expect(stale.isStale("p", 7, B)).toBe(false);
    events.append({
      projectId: "p",
      issueId: 7,
      runId: null,
      type: "Note",
      payload: { headSha: B },
      actor: "test",
      at: AT,
    });
    expect(stale.isStale("p", 7, B)).toBe(false);
    stale.markStale("p", 7, A);
    expect(rows()).toHaveLength(1);
  });

  it("adapters satisfy their ports", () => {
    const { stale } = setup();
    const port = stale satisfies StaleVerdicts;
    expect(port.isStale("p", 1, A)).toBe(false);
  });
});
