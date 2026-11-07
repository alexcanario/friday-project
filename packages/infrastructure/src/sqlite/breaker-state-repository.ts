import { eq } from "drizzle-orm";
import type { BreakerStateRepository } from "@friday/application";
import type { FridayDatabase } from "./database.ts";
import { breakerState } from "./schema.ts";

export function createBreakerStateRepository(db: FridayDatabase): BreakerStateRepository {
  return {
    get(projectId) {
      const row = db.orm
        .select()
        .from(breakerState)
        .where(eq(breakerState.projectId, projectId))
        .get();
      if (!row) return null;
      return { openedAt: row.openedAt, failures: JSON.parse(row.failuresJson) as string[] };
    },
    save(projectId, state) {
      const values = { openedAt: state.openedAt, failuresJson: JSON.stringify(state.failures) };
      db.orm
        .insert(breakerState)
        .values({ projectId, ...values })
        .onConflictDoUpdate({ target: breakerState.projectId, set: values })
        .run();
    },
  };
}
