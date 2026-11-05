import { openDatabase, type FridayDatabase } from "../src/sqlite/database.ts";
import { tempDbPath } from "./sqlite-helpers.ts";

export function openWithProjects(...ids: string[]): FridayDatabase {
  const db = openDatabase(tempDbPath());
  for (const id of ids) db.sqlite.prepare("INSERT INTO projects (id) VALUES (?)").run(id);
  return db;
}
