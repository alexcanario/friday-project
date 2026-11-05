import { eq } from "drizzle-orm";
import type { RunLookup } from "@friday/application";
import type { FridayDatabase } from "./database.ts";
import { runs } from "./schema.ts";

/** A run is active while its row exists and has no `finished_at` (D57). */
export function createRunLookup(db: FridayDatabase): RunLookup {
  return {
    isActive(runId) {
      const row = db.orm
        .select({ finishedAt: runs.finishedAt })
        .from(runs)
        .where(eq(runs.id, runId))
        .get();
      return row !== undefined && row.finishedAt === null;
    },
  };
}
