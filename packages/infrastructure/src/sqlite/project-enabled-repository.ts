import { eq } from "drizzle-orm";
import type { ProjectEnabledRepository } from "@friday/application";
import type { FridayDatabase } from "./database.ts";
import { projectEnabled } from "./schema.ts";

export function createProjectEnabledRepository(db: FridayDatabase): ProjectEnabledRepository {
  return {
    get(projectId) {
      const row = db.orm
        .select()
        .from(projectEnabled)
        .where(eq(projectEnabled.projectId, projectId))
        .get();
      return row ? row.enabled : null;
    },
    save(projectId, enabled) {
      db.orm
        .insert(projectEnabled)
        .values({ projectId, enabled })
        .onConflictDoUpdate({ target: projectEnabled.projectId, set: { enabled } })
        .run();
    },
  };
}
