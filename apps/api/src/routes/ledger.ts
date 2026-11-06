import type { ApiDeps } from "../app.ts";
import { daySum, dayParams, projectQuery } from "../schemas.ts";
import type { App } from "./types.ts";

export function ledgerRoutes(app: App, deps: ApiDeps): void {
  app.get(
    "/ledger/days/:day",
    {
      schema: { params: dayParams, querystring: projectQuery, response: { 200: daySum } },
    },
    (req) => deps.ledger.sumByDay(req.query.project, req.params.day),
  );
}
