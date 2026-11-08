import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventStore, openDatabase } from "@friday/infrastructure";
import { describe, expect, it } from "vitest";
import { createPrOf } from "../src/index.ts";

const AT = "2026-11-08T03:00:00.000Z";

function setup() {
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), "friday-prof-")), "friday.db"));
  db.sqlite.prepare("INSERT OR IGNORE INTO projects (id) VALUES (?)").run("p");
  db.sqlite.prepare("INSERT OR IGNORE INTO projects (id) VALUES (?)").run("q");
  const events = createEventStore(db);
  const add = (type: string, payload: unknown, issueId = 5, projectId = "p") =>
    events.append({ projectId, issueId, runId: null, type, payload, actor: "daemon", at: AT });
  return { events, add, prOf: createPrOf(events, "p") };
}

describe("createPrOf", () => {
  it("returns the number of the last PrOpened of the issue", () => {
    const t = setup();
    t.add("PrOpened", { number: 7 });
    expect(t.prOf(5)).toBe(7);
    t.add("PrOpened", { number: 9 });
    expect(t.prOf(5)).toBe(9);
  });

  it("returns null without a PrOpened for that issue and project", () => {
    const t = setup();
    expect(t.prOf(5)).toBeNull();
    t.add("StateChanged", { to: "InProgress" });
    t.add("WorkReported", { headSha: "a" });
    t.add("PrOpened", { number: 7 }, 6);
    t.add("PrOpened", { number: 8 }, 5, "q");
    expect(t.prOf(5)).toBeNull();
  });

  it("ignores invalid payloads and returns the last valid number", () => {
    const t = setup();
    for (const bad of [{ number: 0 }, { number: -3 }, { number: 1.5 }, { number: "7" }, {}, null])
      t.add("PrOpened", bad);
    expect(t.prOf(5)).toBeNull();
    t.add("PrOpened", { number: 4 });
    t.add("PrOpened", { number: 0 });
    expect(t.prOf(5)).toBe(4);
  });
});
