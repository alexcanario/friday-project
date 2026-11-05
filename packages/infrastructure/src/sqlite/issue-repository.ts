import { and, asc, eq } from "drizzle-orm";
import type { IssueRepository, IssueRow, StateChangedPayload } from "@friday/application";
import type { FridayDatabase } from "./database.ts";
import { events, issues } from "./schema.ts";

function toRow(r: typeof issues.$inferSelect): IssueRow {
  return {
    projectId: r.projectId,
    issueId: r.id,
    state: r.state,
    heldReason: r.heldReason,
    verifyRound: r.verifyRound,
    qaRound: r.qaRound,
    reviewIter: r.reviewIter,
  };
}

export function createIssueRepository(db: FridayDatabase): IssueRepository {
  return {
    get(projectId, issueId) {
      const r = db.orm
        .select()
        .from(issues)
        .where(and(eq(issues.projectId, projectId), eq(issues.id, issueId)))
        .get();
      return r ? toRow(r) : null;
    },
    list(projectId) {
      const rows = db.orm
        .select()
        .from(issues)
        .where(eq(issues.projectId, projectId))
        .orderBy(asc(issues.id))
        .all();
      return rows.map(toRow);
    },
    rebuild(projectId) {
      db.orm.transaction((tx) => {
        const rows = tx
          .select()
          .from(events)
          .where(and(eq(events.projectId, projectId), eq(events.type, "StateChanged")))
          .orderBy(asc(events.seq))
          .all();
        const latest = new Map<number, StateChangedPayload>();
        for (const r of rows) {
          if (r.issueId === null) continue;
          latest.set(r.issueId, JSON.parse(r.payloadJson) as StateChangedPayload);
        }
        tx.delete(issues).where(eq(issues.projectId, projectId)).run();
        for (const [id, p] of latest) {
          tx.insert(issues)
            .values({
              projectId,
              id,
              state: p.to,
              heldReason: p.heldReason,
              verifyRound: p.verifyRound,
              qaRound: p.qaRound,
              reviewIter: p.reviewIter,
            })
            .run();
        }
      });
    },
  };
}
