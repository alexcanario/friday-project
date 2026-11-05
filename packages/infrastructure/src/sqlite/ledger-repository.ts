import { and, eq, sql } from "drizzle-orm";
import type { LedgerRepository } from "@friday/application";
import type { FridayDatabase } from "./database.ts";
import { ledger } from "./schema.ts";

export function createLedgerRepository(db: FridayDatabase): LedgerRepository {
  return {
    record(entry) {
      db.orm
        .insert(ledger)
        .values({ ...entry, costUnknown: entry.costUnknown ? 1 : 0 })
        .run();
    },
    sumByDay(projectId, day) {
      const row = db.orm
        .select({
          total: sql<number>`COALESCE(SUM(${ledger.costUsd}), 0)`,
          unknown: sql<number>`COALESCE(MAX(${ledger.costUnknown}), 0)`,
        })
        .from(ledger)
        .where(and(eq(ledger.projectId, projectId), eq(ledger.day, day)))
        .get();
      return { costUsd: row?.total ?? 0, anyCostUnknown: (row?.unknown ?? 0) > 0 };
    },
  };
}
