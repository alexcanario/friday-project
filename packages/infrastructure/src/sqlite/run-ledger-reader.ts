import { and, eq, sql } from "drizzle-orm";
import type { RunLedgerReader } from "@friday/application";
import type { FridayDatabase } from "./database.ts";
import { ledger } from "./schema.ts";

export function createRunLedgerReader(db: FridayDatabase): RunLedgerReader {
  return {
    sumByRun(projectId, runId) {
      const row = db.orm
        .select({
          rows: sql<number>`COUNT(*)`,
          unknown: sql<number>`COALESCE(MAX(${ledger.costUnknown}), 0)`,
          cost: sql<number | null>`SUM(${ledger.costUsd})`,
          turns: sql<number | null>`SUM(${ledger.numTurns})`,
        })
        .from(ledger)
        .where(and(eq(ledger.projectId, projectId), eq(ledger.runId, runId)))
        .get();
      if (row === undefined || row.rows === 0) return { costUsd: null, numTurns: null };
      return { costUsd: row.unknown > 0 ? null : row.cost, numTurns: row.turns };
    },
  };
}
