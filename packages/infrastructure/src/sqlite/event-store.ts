import { and, asc, eq } from "drizzle-orm";
import type { EventStore, NewEvent, StoredEvent } from "@friday/application";
import type { FridayDatabase } from "./database.ts";
import { events } from "./schema.ts";

type Row = typeof events.$inferSelect;

const toStored = (r: Row): StoredEvent => ({
  seq: r.seq,
  projectId: r.projectId,
  issueId: r.issueId,
  runId: r.runId,
  type: r.type,
  payload: JSON.parse(r.payloadJson) as unknown,
  actor: r.actor,
  at: r.at,
});

export function createEventStore(db: FridayDatabase): EventStore {
  return {
    append(event: NewEvent) {
      const row = db.orm
        .insert(events)
        .values({
          projectId: event.projectId,
          issueId: event.issueId,
          runId: event.runId,
          type: event.type,
          payloadJson: JSON.stringify(event.payload),
          actor: event.actor,
          at: event.at,
        })
        .returning()
        .get();
      return toStored(row);
    },
    list(projectId, issueId) {
      return db.orm
        .select()
        .from(events)
        .where(and(eq(events.projectId, projectId), eq(events.issueId, issueId)))
        .orderBy(asc(events.seq))
        .all()
        .map(toStored);
    },
  };
}
