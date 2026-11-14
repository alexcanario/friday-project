import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProjectEnabledRepository } from "../src/index.ts";
import { openDatabase, type FridayDatabase } from "../src/sqlite/database.ts";
import { tempDbPath } from "./sqlite-helpers.ts";

let db: FridayDatabase;
beforeEach(() => {
  db = openDatabase(tempDbPath());
  db.sqlite.prepare("INSERT INTO projects (id) VALUES ('a')").run();
  db.sqlite.prepare("INSERT INTO projects (id) VALUES ('b')").run();
});
afterEach(() => db.close());

type Col = { name: string; type: string; notnull: number; pk: number };

describe("sqlite project_enabled", () => {
  it("creates the project_enabled table", () => {
    const cols = db.sqlite.pragma("table_info(project_enabled)") as Col[];
    const by = (n: string) => cols.find((c) => c.name === n);
    expect(by("project_id")).toMatchObject({ pk: 1 });
    expect(by("project_id")?.type.toLowerCase()).toBe("text");
    expect(by("enabled")).toMatchObject({ notnull: 1 });
    expect(by("enabled")?.type.toLowerCase()).toBe("integer");
    const fks = db.sqlite.pragma("foreign_key_list(project_enabled)") as Array<{
      from: string;
      table: string;
      to: string;
    }>;
    expect(fks).toMatchObject([{ from: "project_id", table: "projects", to: "id" }]);
  });

  it("returns null when the project has no saved value", () => {
    expect(createProjectEnabledRepository(db).get("a")).toBeNull();
  });

  it("saves true and false and reads them back as booleans", () => {
    const repo = createProjectEnabledRepository(db);
    repo.save("a", true);
    expect(repo.get("a")).toBe(true);
    repo.save("a", false);
    expect(repo.get("a")).toBe(false);
  });

  it("overwrites the value of a project keeping one row", () => {
    const repo = createProjectEnabledRepository(db);
    repo.save("a", true);
    repo.save("a", false);
    expect(repo.get("a")).toBe(false);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM project_enabled WHERE project_id = 'a'").get(),
    ).toEqual({ n: 1 });
  });

  it("keeps projects isolated from each other", () => {
    const repo = createProjectEnabledRepository(db);
    repo.save("a", false);
    repo.save("b", true);
    expect(repo.get("a")).toBe(false);
    expect(repo.get("b")).toBe(true);
  });

  it("rejects a project that does not exist", () => {
    const repo = createProjectEnabledRepository(db);
    expect(() => repo.save("inexistente", true)).toThrow(/FOREIGN KEY/);
    expect(repo.get("inexistente")).toBeNull();
  });
});
