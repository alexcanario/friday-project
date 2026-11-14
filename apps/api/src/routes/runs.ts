import type { RunRecord } from "@friday/application";
import { z } from "zod";
import type { ApiDeps } from "../app.ts";
import { errorResponse, runItem } from "@friday/contracts";
import { projectQuery, runParams } from "../schemas.ts";
import type { App } from "./types.ts";

const toItem = (deps: ApiDeps, r: RunRecord) => ({
  id: r.id,
  issueId: r.issueId,
  phase: r.phase,
  status: r.status,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  ...deps.runLedger.sumByRun(r.projectId, r.id),
});

export function runRoutes(app: App, deps: ApiDeps): void {
  app.get(
    "/runs",
    { schema: { querystring: projectQuery, response: { 200: z.array(runItem) } } },
    (req) => deps.runs.list(req.query.project).map((r) => toItem(deps, r)),
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
      return toItem(deps, run);
    },
  );
}
