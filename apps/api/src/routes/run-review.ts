import { runReview, type RunReview } from "@friday/contracts";
import type { StoredEvent } from "@friday/application";
import type { ApiDeps } from "../app.ts";
import { errorResponse, projectQuery, runParams } from "../schemas.ts";
import type { App } from "./types.ts";

const OUTCOMES = ["approve", "reject", "changes_requested"] as const;

type Judge = NonNullable<RunReview["judge"]>;

function payloadOf(event: StoredEvent): Record<string, unknown> | null {
  const p = event.payload;
  return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : null;
}

function judgeOf(events: StoredEvent[], runId: string): Judge | null {
  let found: StoredEvent | null = null;
  let judge: Judge | null = null;
  for (const e of events) {
    if (e.type !== "JudgeFinished" || e.runId !== runId) continue;
    const p = payloadOf(e);
    const outcome = OUTCOMES.find((o) => o === p?.outcome);
    if (p === null || outcome === undefined || !Number.isInteger(p.reviewId)) continue;
    if (found !== null && e.seq < found.seq) continue;
    found = e;
    const feedback = typeof p.feedback === "string" ? p.feedback : null;
    judge = { outcome, reviewId: p.reviewId as number, feedback, at: e.at };
  }
  return judge;
}

/** Same validity rule as `createPrOf` in the daemon (not importable here). */
function prOf(events: StoredEvent[]): RunReview["pr"] {
  let number: number | null = null;
  for (const e of events) {
    if (e.type !== "PrOpened") continue;
    const value = payloadOf(e)?.number;
    if (typeof value === "number" && Number.isInteger(value) && value > 0) number = value;
  }
  return number === null ? null : { number };
}

export function runReviewRoutes(app: App, deps: ApiDeps): void {
  app.get(
    "/runs/:runId/review",
    {
      schema: {
        params: runParams,
        querystring: projectQuery,
        response: { 200: runReview, 404: errorResponse },
      },
    },
    async (req, reply) => {
      const run = deps.runs.get(req.params.runId);
      if (run === null || run.projectId !== req.query.project) {
        return reply.code(404).send({ message: "Run não encontrada." });
      }
      const events = deps.events.list(run.projectId, run.issueId);
      return { judge: judgeOf(events, run.id), pr: prOf(events) };
    },
  );
}
