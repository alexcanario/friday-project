import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type FridayDatabase } from "@friday/infrastructure";
import { apiDepsOf } from "../src/daemon-panel.ts";

let db: FridayDatabase;
afterEach(() => db.close());

describe("apiDepsOf", () => {
  it("apiDepsOf exposes the project list", () => {
    db = openDatabase(join(mkdtempSync(join(tmpdir(), "friday-panel-projects-")), "friday.db"));
    db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p1')").run();
    expect(apiDepsOf(db).projects.list()).toEqual(["p1"]);
  });
});
