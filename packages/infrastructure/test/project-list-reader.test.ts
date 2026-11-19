import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProjectListReader } from "../src/index.ts";
import { openDatabase, type FridayDatabase } from "../src/sqlite/database.ts";
import { tempDbPath } from "./sqlite-helpers.ts";

let db: FridayDatabase;
beforeEach(() => {
  db = openDatabase(tempDbPath());
});
afterEach(() => db.close());

describe("createProjectListReader", () => {
  it("lists project ids in ascending order", () => {
    const reader = createProjectListReader(db);
    expect(reader.list()).toEqual([]);
    db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p2')").run();
    db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p1')").run();
    expect(reader.list()).toEqual(["p1", "p2"]);
  });
});
