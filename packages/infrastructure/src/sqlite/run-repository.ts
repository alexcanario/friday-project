import { and, asc, eq, isNull } from "drizzle-orm";
import type { RunRepository } from "@friday/application";
import type { FridayDatabase } from "./database.ts";
import { runs } from "./schema.ts";

export function createRunRepository(db: FridayDatabase): RunRepository {
  return {
    save(run) {
      db.orm.insert(runs).values(run).onConflictDoUpdate({ target: runs.id, set: run }).run();
    },
    get(runId) {
      return db.orm.select().from(runs).where(eq(runs.id, runId)).get() ?? null;
    },
    list(projectId) {
      return db.orm
        .select()
        .from(runs)
        .where(eq(runs.projectId, projectId))
        .orderBy(asc(runs.startedAt), asc(runs.id))
        .all();
    },
    listActive(projectId) {
      return db.orm
        .select()
        .from(runs)
        .where(
          and(eq(runs.projectId, projectId), eq(runs.status, "running"), isNull(runs.finishedAt)),
        )
        .orderBy(asc(runs.id))
        .all();
    },
  };
}
