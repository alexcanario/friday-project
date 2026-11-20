import type { OutgoingHttpHeaders, ServerResponse } from "node:http";
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

interface OpenStream {
  timer: NodeJS.Timeout;
  raw: ServerResponse;
}

/** One poll step of a stream: writes the new event frames and the changed costs. */
function createPoll(
  deps: ApiDeps,
  project: string,
  raw: ServerResponse,
  start: number,
): () => void {
  let cursor = start;
  const followed = new Map<number, CostUpdatedEvent>();
  const sendCost = (issueId: number, always: boolean): void => {
    const sum = deps.ledger.sumByIssue(project, issueId);
    const prev = followed.get(issueId);
    if (!always && prev?.costUsd === sum.costUsd && prev.anyCostUnknown === sum.anyCostUnknown)
      return;
    const next = { issueId, ...sum };
    followed.set(issueId, next);
    raw.write(frame("cost_updated", next));
  };
  return () => {
    for (const e of deps.events.listSince(project, cursor)) {
      cursor = e.seq;
      const out = e.issueId === null ? null : eventFrame(e);
      if (out === null || e.issueId === null) continue;
      raw.write(out);
      if (e.type === "RunFinished") sendCost(e.issueId, true);
    }
    for (const issueId of [...followed.keys()]) sendCost(issueId, false);
  };
}

export function eventsRoutes(app: App, deps: ApiDeps): void {
  const open = new Set<OpenStream>();
  app.addHook("preClose", () => {
    for (const s of open) {
      clearInterval(s.timer);
      s.raw.end();
    }
    open.clear();
  });
  app.get(
    "/events/stream",
    { schema: { querystring: projectQuery, response: { 200: z.string() } } },
    (req, reply) => {
      const project = req.query.project;
      const resumeFrom = parseLastEventId(req.headers["last-event-id"]);
      const cursor = resumeFrom ?? deps.events.listSince(project, 0).at(-1)?.seq ?? 0;
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        ...(reply.getHeaders() as OutgoingHttpHeaders),
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      raw.flushHeaders();
      const poll = createPoll(deps, project, raw, cursor);
      const tick = (): void => {
        try {
          poll();
        } catch (err) {
          req.log.warn({ err }, "sse tick failed; closing stream");
          clearInterval(timer);
          open.delete(entry);
          raw.end();
        }
      };
      const timer = setInterval(tick, deps.ssePollMs ?? DEFAULT_POLL_MS);
      const entry: OpenStream = { timer, raw };
      open.add(entry);
      raw.on("close", () => {
        clearInterval(timer);
        open.delete(entry);
      });
      if (resumeFrom !== null) tick();
    },
  );
}
