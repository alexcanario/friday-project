import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type FridayDatabase } from "../src/sqlite/database.ts";
import { tempDbPath } from "./sqlite-helpers.ts";

let db: FridayDatabase;
beforeEach(() => {
  db = openDatabase(tempDbPath());
});
afterEach(() => db.close());

const run = (sql: string, ...args: unknown[]) => db.sqlite.prepare(sql).run(...args);

describe("sqlite schema", () => {
  it("has project_id on every table and enforces the foreign key", () => {
    for (const t of ["issues", "runs", "events", "ledger", "run_results"]) {
      const cols = db.sqlite.pragma(`table_info(${t})`) as Array<{
        name: string;
        notnull: number;
      }>;
      const col = cols.find((c) => c.name === "project_id");
      expect(col, t).toBeDefined();
      expect(col?.notnull, t).toBe(1);
    }
    const projectCols = db.sqlite.pragma("table_info(projects)") as Array<{ name: string }>;
    expect(projectCols.map((c) => c.name)).not.toContain("project_id");
    expect(() =>
      run("INSERT INTO issues (project_id, id, state) VALUES (?, ?, ?)", "missing", 1, "backlog"),
    ).toThrow(/FOREIGN KEY/);
  });

  it("project method defaults to agile and rejects unknown values", () => {
    run("INSERT INTO projects (id) VALUES ('a')");
    expect(db.sqlite.prepare("SELECT method, profile FROM projects").get()).toEqual({
      method: "agile",
      profile: null,
    });
    expect(() => run("INSERT INTO projects (id, method) VALUES ('b', 'x')")).toThrow(/CHECK/);
    run("INSERT INTO projects (id, method) VALUES ('c', 'lens')");
    run("INSERT INTO projects (id, profile) VALUES ('d', 'web-api')");
    expect(db.sqlite.prepare("SELECT profile FROM projects WHERE id = 'd'").get()).toEqual({
      profile: "web-api",
    });
  });

  it("stores the pack phase of a run", () => {
    run("INSERT INTO projects (id) VALUES ('p')");
    run("INSERT INTO runs (id, project_id, issue_id, phase) VALUES ('r1', 'p', 1, 'implement')");
    run("INSERT INTO runs (id, project_id, issue_id, phase) VALUES ('r2', 'p', 1, NULL)");
    const rows = db.sqlite.prepare("SELECT id, phase FROM runs ORDER BY id").all();
    expect(rows).toEqual([
      { id: "r1", phase: "implement" },
      { id: "r2", phase: null },
    ]);
  });

  it("trigger rejects UPDATE and DELETE on events", () => {
    run("INSERT INTO projects (id) VALUES ('p')");
    run(
      "INSERT INTO events (project_id, issue_id, type, payload_json, actor, at) VALUES ('p', 1, 't', '{}', 'a', 'now')",
    );
    expect(() => run("UPDATE events SET type = 'x'")).toThrow();
    expect(() => run("DELETE FROM events")).toThrow();
    expect(() =>
      run(
        "INSERT OR REPLACE INTO events (seq, project_id, issue_id, type, payload_json, actor, at) VALUES (1, 'p', 1, 'forged', '{}', 'a', 'now')",
      ),
    ).toThrow();
    expect(db.sqlite.prepare("SELECT type FROM events WHERE seq = 1").get()).toEqual({ type: "t" });
    run(
      "INSERT INTO events (project_id, issue_id, type, payload_json, actor, at) VALUES ('p', 1, 't2', '{}', 'a', 'now')",
    );
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM events").get()).toEqual({ n: 2 });
  });

  it("enforces one result per run and kind", () => {
    run("INSERT INTO projects (id) VALUES ('p')");
    run(
      "INSERT INTO run_results (project_id, run_id, kind, value_json) VALUES ('p', 'r', 'qa', '{}')",
    );
    expect(() =>
      run(
        "INSERT INTO run_results (project_id, run_id, kind, value_json) VALUES ('p', 'r', 'qa', '{}')",
      ),
    ).toThrow(/UNIQUE/);
    run(
      "INSERT INTO run_results (project_id, run_id, kind, value_json) VALUES ('p', 'r', 'judge', '{}')",
    );
  });

  it("run_results requires value_json", () => {
    const cols = db.sqlite.pragma("table_info(run_results)") as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const col = cols.find((c) => c.name === "value_json");
    expect(col?.type.toLowerCase()).toBe("text");
    expect(col?.notnull).toBe(1);
    run("INSERT INTO projects (id) VALUES ('p1')");
    expect(() =>
      run(
        "INSERT INTO run_results (project_id, run_id, kind, value_json) VALUES ('p1', 'r1', 'qaReport', NULL)",
      ),
    ).toThrow();
    run(
      "INSERT INTO run_results (project_id, run_id, kind, value_json) VALUES ('p1', 'r1', 'qaReport', '{}')",
    );
  });

  it("runs has a status column defaulting to running", () => {
    const cols = db.sqlite.pragma("table_info(runs)") as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const col = cols.find((c) => c.name === "status");
    // SQLite reports the type of a column added by ALTER TABLE in upper case.
    expect(col?.type.toLowerCase()).toBe("text");
    expect(col).toMatchObject({ notnull: 1, dflt_value: "'running'" });
    run("INSERT INTO projects (id) VALUES ('p')");
    run("INSERT INTO runs (id, project_id, issue_id) VALUES ('r9', 'p', 1)");
    expect(db.sqlite.prepare("SELECT status FROM runs WHERE id = 'r9'").get()).toEqual({
      status: "running",
    });
    expect(() =>
      run("INSERT INTO runs (id, project_id, issue_id, status) VALUES ('r8', 'p', 1, NULL)"),
    ).toThrow();
  });
});
