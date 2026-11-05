import { and, eq } from "drizzle-orm";
import type { ResultStore } from "@friday/application";
import type { FridayDatabase } from "./database.ts";
import { runResults, runs } from "./schema.ts";

export function createResultStore(db: FridayDatabase): ResultStore {
  return {
    has(runId, kind) {
      const row = db.orm
        .select({ id: runResults.id })
        .from(runResults)
        .where(and(eq(runResults.runId, runId), eq(runResults.kind, kind)))
        .get();
      return row !== undefined;
    },
    record(runId, kind, value) {
      const run = db.orm
        .select({ projectId: runs.projectId })
        .from(runs)
        .where(eq(runs.id, runId))
        .get();
      if (run === undefined) throw new Error(`Run sem linha em runs: ${runId}`);
      db.orm
        .insert(runResults)
        .values({ projectId: run.projectId, runId, kind, valueJson: JSON.stringify(value) })
        .run();
    },
  };
}
