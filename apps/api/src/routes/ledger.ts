import type { ApiDeps } from "../app.ts";
import { daySum } from "@friday/contracts";
import { dayParams, issueParams, projectQuery } from "../schemas.ts";
import type { App } from "./types.ts";

export function ledgerRoutes(app: App, deps: ApiDeps): void {
  app.get(
    "/ledger/days/:day",
    {
      schema: { params: dayParams, querystring: projectQuery, response: { 200: daySum } },
    },
    (req) => deps.ledger.sumByDay(req.query.project, req.params.day),
  );

  app.get(
    "/ledger/issues/:issueId",
    {
      schema: { params: issueParams, querystring: projectQuery, response: { 200: daySum } },
    },
    (req) => deps.ledger.sumByIssue(req.query.project, req.params.issueId),
  );
}
