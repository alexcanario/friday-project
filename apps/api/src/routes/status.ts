import type { ApiDeps } from "../app.ts";
import { BREAKER_OPEN_MS } from "@friday/application";
import { statusResponse, type StatusResponse } from "@friday/contracts";
import { projectQuery } from "../schemas.ts";
import type { App } from "./types.ts";

export function statusRoutes(app: App, deps: ApiDeps): void {
  app.get(
    "/status",
    { schema: { querystring: projectQuery, response: { 200: statusResponse } } },
    (req): StatusResponse => {
      const project = req.query.project;
      const state = deps.breaker.get(project);
      const openedAt = state?.openedAt ?? null;
      const open = openedAt !== null && deps.now() < Date.parse(openedAt) + BREAKER_OPEN_MS;
      return {
        enabled: deps.enabled.get(project),
        breaker: { open, openedAt, failures: state?.failures ?? [] },
      };
    },
  );
}
