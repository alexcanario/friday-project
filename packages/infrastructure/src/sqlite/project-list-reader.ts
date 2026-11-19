import type { ProjectListReader } from "@friday/application";
import type { FridayDatabase } from "./database.ts";

export function createProjectListReader(db: FridayDatabase): ProjectListReader {
  return {
    list() {
      const rows = db.sqlite.prepare("SELECT id FROM projects ORDER BY id").all() as {
        id: string;
      }[];
      return rows.map((row) => row.id);
    },
  };
}
