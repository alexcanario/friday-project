import type { EventStore } from "@friday/application";

/** Reads the number of the last valid PrOpened event of an issue (D71, D74). */
export function createPrOf(
  events: EventStore,
  projectId: string,
): (issueId: number) => number | null {
  return (issueId) => {
    let found: number | null = null;
    for (const event of events.list(projectId, issueId)) {
      if (event.type !== "PrOpened") continue;
      const payload = event.payload;
      if (typeof payload !== "object" || payload === null) continue;
      const value = (payload as { number?: unknown }).number;
      if (typeof value === "number" && Number.isInteger(value) && value > 0) found = value;
    }
    return found;
  };
}
