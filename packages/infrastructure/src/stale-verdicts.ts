import type { EventStore, StaleVerdicts } from "@friday/application";

const TYPE = "VerdictInvalidated";

export class SqliteStaleVerdicts implements StaleVerdicts {
  private readonly events: EventStore;
  private readonly now: () => Date;

  constructor(events: EventStore, now: () => Date) {
    this.events = events;
    this.now = now;
  }

  markStale(projectId: string, issueId: number, headSha: string): void {
    if (this.isStale(projectId, issueId, headSha)) return;
    this.events.append({
      projectId,
      issueId,
      runId: null,
      type: TYPE,
      payload: { headSha },
      actor: "daemon",
      at: this.now().toISOString(),
    });
  }

  isStale(projectId: string, issueId: number, headSha: string): boolean {
    return this.events
      .list(projectId, issueId)
      .some(
        (e) => e.type === TYPE && (e.payload as { headSha?: unknown } | null)?.headSha === headSha,
      );
  }
}
