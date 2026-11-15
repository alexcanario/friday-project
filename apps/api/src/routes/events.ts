import type { StoredEvent } from "@friday/application";
import type { CostUpdatedEvent } from "@friday/contracts";
import { z } from "zod";
import type { ApiDeps } from "../app.ts";
import { projectQuery } from "../schemas.ts";
import type { App } from "./types.ts";

const DEFAULT_POLL_MS = 1000;

const frame = (event: string, data: unknown, id?: number): string =>
  `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function parseLastEventId(header: string | string[] | undefined): number | null {
  if (typeof header !== "string" || !/^\d+$/.test(header.trim())) return null;
  return Number(header.trim());
}

/** Frames of one stored event, or `null` when the event type is not streamed. */
function eventFrame(e: StoredEvent): string | null {
  const p = (e.payload ?? {}) as { from?: unknown; to?: unknown; heldReason?: unknown };
  if (e.type === "StateChanged") {
    const held = typeof p.heldReason === "string" ? p.heldReason : null;
    return frame(
      "stage_changed",
      { issueId: e.issueId, from: p.from, to: p.to, heldReason: held },
      e.seq,
    );
  }
  if (e.type === "RunFinished") {
    return frame("run_finished", { issueId: e.issueId, runId: e.runId }, e.seq);
  }
  return null;
}

export function eventsRoutes(app: App, deps: ApiDeps): void {
  app.get(
    "/events/stream",
    { schema: { querystring: projectQuery, response: { 200: z.string() } } },
    (req, reply) => {
      const project = req.query.project;
      const resumeFrom = parseLastEventId(req.headers["last-event-id"]);
      let cursor = resumeFrom ?? deps.events.listSince(project, 0).at(-1)?.seq ?? 0;
      const followed = new Map<number, CostUpdatedEvent>();
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      raw.flushHeaders();

      const sendCost = (issueId: number, always: boolean): void => {
        const sum = deps.ledger.sumByIssue(project, issueId);
        const prev = followed.get(issueId);
        if (!always && prev?.costUsd === sum.costUsd && prev.anyCostUnknown === sum.anyCostUnknown)
          return;
        const next = { issueId, ...sum };
        followed.set(issueId, next);
        raw.write(frame("cost_updated", next));
      };
      const tick = (): void => {
        try {
          for (const e of deps.events.listSince(project, cursor)) {
            cursor = e.seq;
            const out = e.issueId === null ? null : eventFrame(e);
            if (out === null || e.issueId === null) continue;
            raw.write(out);
            if (e.type === "RunFinished") sendCost(e.issueId, true);
          }
          for (const issueId of [...followed.keys()]) sendCost(issueId, false);
        } catch {
          clearInterval(timer);
          raw.end();
        }
      };
      const timer = setInterval(tick, deps.ssePollMs ?? DEFAULT_POLL_MS);
      raw.on("close", () => clearInterval(timer));
      if (resumeFrom !== null) tick();
    },
  );
}
