import { z } from "zod";
import type { ApiDeps } from "../app.ts";
import { approvalItem, projectQuery } from "../schemas.ts";
import type { App } from "./types.ts";

export function approvalRoutes(app: App, deps: ApiDeps): void {
  app.get(
    "/approvals",
    { schema: { querystring: projectQuery, response: { 200: z.array(approvalItem) } } },
    (req) =>
      deps.approvals.listPending(req.query.project, deps.now()).map((a) => ({
        id: a.id,
        issueId: a.issueId,
        pr: a.pr,
        headSha: a.headSha,
        tier: a.tier,
        requestedAt: a.requestedAt,
        expiresAt: a.expiresAt,
      })),
  );
}
