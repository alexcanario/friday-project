import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/sqlite/database.ts";
import { tempDbPath } from "./sqlite-helpers.ts";

describe("openDatabase", () => {
  it("applies the initial migration and enables WAL", () => {
    const db = openDatabase(tempDbPath());
    try {
      expect(db.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
      const tables = db.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => (r as { name: string }).name);
      for (const t of ["projects", "issues", "runs", "events", "ledger", "run_results"]) {
        expect(tables).toContain(t);
      }
    } finally {
      db.close();
    }
  });

  it("sets the busy timeout", () => {
    const seen: unknown[] = [];
    const fake = (path: string, options?: Database.Options) => {
      seen.push(options);
      return new Database(path, options);
    };
    const db = openDatabase(tempDbPath(), { open: fake });
    try {
      expect(seen[0]).toMatchObject({ timeout: 5000 });
      expect(db.sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
    } finally {
      db.close();
    }
  });

  it("refuses a second writer on the same path", () => {
    const path = tempDbPath();
    const first = openDatabase(path);
    expect(() => openDatabase(path)).toThrow();
    first.close();
    const again = openDatabase(path);
    const other = openDatabase(tempDbPath("other.db"));
    again.close();
    other.close();
  });
});
