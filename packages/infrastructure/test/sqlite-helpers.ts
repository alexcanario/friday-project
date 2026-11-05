import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function tempDbPath(name = "friday.db"): string {
  return join(mkdtempSync(join(tmpdir(), "friday-db-")), name);
}
