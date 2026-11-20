import type { QueryClient } from "@tanstack/react-query";
import { costUpdatedEvent, runFinishedEvent, stageChangedEvent } from "@friday/contracts";
import type { ConnectionState } from "./connection-state.ts";
import { createFetchSource } from "./fetch-source.ts";
import { queryKeys } from "./query-keys.ts";

export interface LiveSource {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  close(): void;
}

export interface LiveEventsOptions {
  baseUrl: string;
  project: string | undefined;
  queryClient: Pick<QueryClient, "invalidateQueries">;
  onState?: (state: ConnectionState) => void;
  createSource?: (url: string) => LiveSource;
  /** Sent only in the `x-friday-token` header of the fetch source, never in the URL. */
  token?: string;
  /** When set, a frame also invalidates the approvals and the status card of this host. */
  host?: string;
}

interface FrameSchema {
  safeParse(value: unknown): { success: true; data: { issueId: number } } | { success: false };
}

const FRAMES: [string, FrameSchema][] = [
  ["stage_changed", stageChangedEvent],
  ["run_finished", runFinishedEvent],
  ["cost_updated", costUpdatedEvent],
];

function parseFrame(schema: FrameSchema, data: unknown): number | null {
  if (typeof data !== "string") return null;
  try {
    const result = schema.safeParse(JSON.parse(data));
    return result.success ? result.data.issueId : null;
  } catch {
    return null;
  }
}

export function subscribeLiveEvents(options: LiveEventsOptions): () => void {
  const { baseUrl, project, queryClient, onState } = options;
  if (project === undefined) return () => undefined;
  const { token, host } = options;
  const create =
    options.createSource ??
    (token !== undefined && token !== ""
      ? (url: string) => createFetchSource(url, token)
      : (url: string) => new EventSource(url));
  const source = create(`${baseUrl}/events/stream?project=${encodeURIComponent(project)}`);
  let closed = false;
  source.addEventListener("open", () => onState?.("connected"));
  source.addEventListener("error", () => {
    if (source.readyState === 0) onState?.("reconnecting");
    else if (source.readyState === 2) onState?.("offline");
  });
  for (const [type, schema] of FRAMES) {
    source.addEventListener(type, (event) => {
      const issueId = closed ? null : parseFrame(schema, event.data);
      if (issueId === null) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues(project) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.issue(project, issueId) });
      if (host === undefined) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals(project, host) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.status(project, host) });
    });
  }
  return () => {
    closed = true;
    source.close();
  };
}
