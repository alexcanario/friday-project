import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventStore, createIssueRepository, openDatabase } from "@friday/infrastructure";
import { describe, expect, it } from "vitest";
import { createIntake } from "../src/index.ts";
import { FakeGitHub } from "./fakes.ts";

function setup(withProject: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "friday-intake-"));
  const db = openDatabase(join(dir, "friday.db"));
  if (withProject) db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p')").run();
  const github = new FakeGitHub();
  github.issues.push({ number: 7, title: "T", body: "B", labels: ["friday"] });
  const logs: string[] = [];
  const intake = createIntake({
    projectId: "p",
    github,
    issues: createIssueRepository(db),
    events: createEventStore(db),
    now: () => new Date("2026-11-05T03:00:00.000Z"),
    log: (m) => logs.push(m),
  });
  return { db, intake, logs };
}

describe("intake with SQLite", () => {
  it("ingests into SQLite once", async () => {
    const { db, intake } = setup(true);
    expect(await intake.ingest()).toEqual([7]);
    expect(createIssueRepository(db).get("p", 7)?.state).toBe("Todo");
    const types = () =>
      createEventStore(db)
        .list("p", 7)
        .map((e) => e.type);
    expect(types()).toEqual(["IssueIngested", "StateChanged"]);
    expect(await intake.ingest()).toEqual([]);
    expect(types()).toEqual(["IssueIngested", "StateChanged"]);
  });

  it("persists the issue body in IssueIngested", async () => {
    const { db, intake } = setup(true);
    await intake.ingest();
    const ingested = createEventStore(db)
      .list("p", 7)
      .find((e) => e.type === "IssueIngested");
    expect((ingested?.payload as { body?: unknown }).body).toBe("B");
  });

  it("logs the foreign key failure when the project row is missing", async () => {
    const { db, intake, logs } = setup(false);
    expect(await intake.ingest()).toEqual([]);
    expect(logs).toContain("Failed to ingest issue 7: FOREIGN KEY constraint failed");
    const count = db.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
    expect(count.n).toBe(0);
  });
});
