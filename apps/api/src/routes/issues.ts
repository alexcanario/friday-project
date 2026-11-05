import type { StateChangedPayload } from "@friday/application";
import { z } from "zod";
import type { ApiDeps } from "../app.ts";
import { errorResponse, issueItem, issueParams, projectQuery, transitionItem } from "../schemas.ts";
import type { App } from "./types.ts";

export function issueRoutes(app: App, deps: ApiDeps): void {
  app.get(
    "/issues",
    { schema: { querystring: projectQuery, response: { 200: z.array(issueItem) } } },
    (req) =>
      deps.issues.list(req.query.project).map((i) => ({
        issueId: i.issueId,
        state: i.state,
        heldReason: i.heldReason,
      })),
  );

  app.get(
    "/issues/:issueId/transitions",
    {
      schema: {
        params: issueParams,
        querystring: projectQuery,
        response: { 200: z.array(transitionItem), 404: errorResponse },
      },
    },
    async (req, reply) => {
      const { project } = req.query;
      const { issueId } = req.params;
      if (deps.issues.get(project, issueId) === null) {
        return reply.code(404).send({ message: "Issue não encontrada." });
      }
      return deps.events
        .list(project, issueId)
        .filter((e) => e.type === "StateChanged")
        .map((e) => {
          const p = e.payload as StateChangedPayload;
          return {
            seq: e.seq,
            at: e.at,
            actor: e.actor,
            runId: e.runId,
            from: p.from,
            to: p.to,
            trigger: p.trigger,
            heldReason: p.heldReason,
          };
        });
    },
  );
}
