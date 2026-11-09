import { and, eq, sql, type SQL } from "drizzle-orm";
import type { DaySum, LedgerReportReader, LedgerRepository } from "@friday/application";
import type { FridayDatabase } from "./database.ts";
import { ledger } from "./schema.ts";

function sumWhere(db: FridayDatabase, where: SQL | undefined): DaySum {
  const row = db.orm
    .select({
      total: sql<number>`COALESCE(SUM(${ledger.costUsd}), 0)`,
      unknown: sql<number>`COALESCE(MAX(${ledger.costUnknown}), 0)`,
    })
    .from(ledger)
    .where(where)
    .get();
  return { costUsd: row?.total ?? 0, anyCostUnknown: (row?.unknown ?? 0) > 0 };
}

export function createLedgerRepository(db: FridayDatabase): LedgerRepository & LedgerReportReader {
  return {
    listIssueSums(projectId) {
      return db.orm
        .select({
          issueId: ledger.issueId,
          costUsd: sql<number>`COALESCE(SUM(${ledger.costUsd}), 0)`,
          unknown: sql<number>`COALESCE(MAX(${ledger.costUnknown}), 0)`,
        })
        .from(ledger)
        .where(eq(ledger.projectId, projectId))
        .groupBy(ledger.issueId)
        .orderBy(ledger.issueId)
        .all()
        .map((r) => ({ issueId: r.issueId, costUsd: r.costUsd, anyCostUnknown: r.unknown > 0 }));
    },
    record(entry) {
      db.orm
        .insert(ledger)
        .values({ ...entry, costUnknown: entry.costUnknown ? 1 : 0 })
        .run();
    },
    sumByDay(projectId, day) {
      return sumWhere(db, and(eq(ledger.projectId, projectId), eq(ledger.day, day)));
    },
    sumByIssue(projectId, issueId) {
      return sumWhere(db, and(eq(ledger.projectId, projectId), eq(ledger.issueId, issueId)));
    },
  };
}
