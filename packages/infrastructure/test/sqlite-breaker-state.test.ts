import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBreakerStateRepository } from "../src/index.ts";
import { openDatabase, type FridayDatabase } from "../src/sqlite/database.ts";
import { tempDbPath } from "./sqlite-helpers.ts";

let db: FridayDatabase;
beforeEach(() => {
  db = openDatabase(tempDbPath());
  db.sqlite.prepare("INSERT INTO projects (id) VALUES ('a')").run();
  db.sqlite.prepare("INSERT INTO projects (id) VALUES ('b')").run();
});
afterEach(() => db.close());

type Col = { name: string; type: string; notnull: number; pk: number; dflt_value: string | null };

describe("sqlite breaker_state", () => {
  it("creates the breaker_state table", () => {
    const cols = db.sqlite.pragma("table_info(breaker_state)") as Col[];
    const by = (n: string) => cols.find((c) => c.name === n);
    expect(by("project_id")).toMatchObject({ pk: 1 });
    expect(by("project_id")?.type.toLowerCase()).toBe("text");
    expect(by("opened_at")).toMatchObject({ notnull: 0 });
    expect(by("opened_at")?.type.toLowerCase()).toBe("text");
    expect(by("failures_json")).toMatchObject({ notnull: 1, dflt_value: "'[]'" });
    expect(by("failures_json")?.type.toLowerCase()).toBe("text");
    const fks = db.sqlite.pragma("foreign_key_list(breaker_state)") as Array<{
      from: string;
      table: string;
      to: string;
    }>;
    expect(fks).toMatchObject([{ from: "project_id", table: "projects", to: "id" }]);
  });

  it("saves, replaces and reads the breaker state", () => {
    const repo = createBreakerStateRepository(db);
    expect(repo.get("a")).toBeNull();
    const first = { openedAt: "2026-11-07T10:00:00.000Z", failures: [] };
    repo.save("a", first);
    expect(repo.get("a")).toEqual(first);
    const second = { openedAt: null, failures: ["2026-11-07T10:05:00.000Z"] };
    repo.save("a", second);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM breaker_state").get()).toEqual({ n: 1 });
    expect(repo.get("a")).toEqual(second);
    expect(repo.get("b")).toBeNull();
  });

  it("rejects a project without a row", () => {
    const repo = createBreakerStateRepository(db);
    expect(() => repo.save("zzz", { openedAt: null, failures: [] })).toThrow(/FOREIGN KEY/);
  });
});
