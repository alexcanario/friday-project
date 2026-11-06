import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import type { ApprovalRecord, ApprovalStore } from "@friday/application";
import type { FridayDatabase } from "./database.ts";
import { approvals } from "./schema.ts";

/** Short id: 8 lowercase hexadecimal characters. */
export const generateApprovalId = (): string => randomBytes(4).toString("hex");

export function createApprovalStore(db: FridayDatabase): ApprovalStore {
  return {
    insert(record: ApprovalRecord) {
      db.orm.insert(approvals).values(record).run();
    },
    get(id) {
      return db.orm.select().from(approvals).where(eq(approvals.id, id)).get() ?? null;
    },
    listPending(projectId, now) {
      return db.orm
        .select()
        .from(approvals)
        .where(
          and(
            eq(approvals.projectId, projectId),
            isNull(approvals.decision),
            gt(approvals.expiresAt, now),
          ),
        )
        .orderBy(asc(approvals.requestedAt), asc(approvals.id))
        .all();
    },
    latestForIssue(projectId, issueId) {
      return (
        db.orm
          .select()
          .from(approvals)
          .where(and(eq(approvals.projectId, projectId), eq(approvals.issueId, issueId)))
          .orderBy(desc(approvals.requestedAt), desc(approvals.id))
          .limit(1)
          .get() ?? null
      );
    },
    decide(id, d) {
      const result = db.orm
        .update(approvals)
        .set(d)
        .where(and(eq(approvals.id, id), isNull(approvals.decision)))
        .run();
      return result.changes === 1;
    },
  };
}
