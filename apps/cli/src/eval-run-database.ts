import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openDatabase, type FridayDatabase } from "@friday/infrastructure";

/** The temporary eval database with the project row the `runs` rows point to. */
export function openEvalDatabase(
  tmpRoot: string,
  projectId: string,
): { db: FridayDatabase; close(): void } {
  const dir = mkdtempSync(join(tmpRoot, "friday-eval-"));
  let db: FridayDatabase | null = null;
  const close = () => {
    try {
      db?.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  try {
    db = openDatabase(join(dir, "eval.db"));
    db.sqlite.prepare("INSERT OR IGNORE INTO projects (id) VALUES (?)").run(projectId);
    return { db, close };
  } catch (error) {
    // The error of the opening prevails over any error of the cleanup.
    try {
      close();
    } catch {
      // ignored on purpose
    }
    throw error;
  }
}
