import { eq } from "drizzle-orm";
import type { RunLookup } from "@friday/application";
import type { FridayDatabase } from "./database.ts";
import { runs } from "./schema.ts";

/** A run is active while its row exists, has no `finished_at` and is `running` (D57). */
export function createRunLookup(db: FridayDatabase): RunLookup {
  return {
    isActive(runId) {
      const row = db.orm
        .select({ finishedAt: runs.finishedAt, status: runs.status })
        .from(runs)
        .where(eq(runs.id, runId))
        .get();
      return row !== undefined && row.finishedAt === null && row.status === "running";
    },
  };
}
