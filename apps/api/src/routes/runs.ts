import type { RunRecord } from "@friday/application";
import { z } from "zod";
import type { ApiDeps } from "../app.ts";
import { errorResponse, projectQuery, runItem, runParams } from "../schemas.ts";
import type { App } from "./types.ts";

const toItem = (r: RunRecord) => ({
  id: r.id,
  issueId: r.issueId,
  phase: r.phase,
  status: r.status,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
});

export function runRoutes(app: App, deps: ApiDeps): void {
  app.get(
    "/runs",
    { schema: { querystring: projectQuery, response: { 200: z.array(runItem) } } },
    (req) => deps.runs.list(req.query.project).map(toItem),
  );

  app.get(
    "/runs/:runId",
    {
      schema: {
        params: runParams,
        querystring: projectQuery,
        response: { 200: runItem, 404: errorResponse },
      },
    },
    async (req, reply) => {
      const run = deps.runs.get(req.params.runId);
      if (run === null || run.projectId !== req.query.project) {
        return reply.code(404).send({ message: "Run não encontrada." });
      }
      return toItem(run);
    },
  );
}
