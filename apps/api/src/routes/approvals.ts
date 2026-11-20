import { applyInputs, decideApproval, type DecideApprovalDeps } from "@friday/application";
import { z } from "zod";
import type { ApiDeps } from "../app.ts";
import { approvalItem } from "@friday/contracts";
import { logError } from "../error-log.ts";
import { isPanelTokenValid } from "../panel-token.ts";
import { projectQuery } from "../schemas.ts";
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
  for (const decision of ["approve", "deny"] as const) decideRoute(app, deps, decision);
}

const OUTCOME_STATUS = {
  merged: 200,
  denied: 200,
  unknown: 404,
  already_decided: 409,
  expired: 409,
  head_changed: 409,
  merge_blocked: 409,
} as const;

/** Marks a failure of the GitHub port; its message is never sent to the client. */
export class GitHubFailure extends Error {}

/** `github` and `readPrHead` of `deps` with every failure turned into a `GitHubFailure`. */
function githubGuarded(deps: ApiDeps): Pick<DecideApprovalDeps, "github" | "readPrHead"> {
  const wrap = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (cause) {
      throw new GitHubFailure("github call failed", { cause });
    }
  };
  return {
    github: { squashMerge: (pr, sha) => wrap(() => deps.github.squashMerge(pr, sha)) },
    readPrHead: (pr) => wrap(() => deps.readPrHead(pr)),
  };
}

function decideRoute(app: App, deps: ApiDeps, decision: "approve" | "deny"): void {
  app.post(
    `/approvals/:id/${decision}`,
    {
      // runs before params validation and before any read, so a bad token never reveals an id
      onRequest: async (req, reply) => {
        if (!isPanelTokenValid(req.headers["x-friday-token"], deps.panelToken)) {
          return reply.code(401).send({ message: "Token do painel inválido." });
        }
      },
      schema: { params: z.object({ id: z.string().min(1) }) },
    },
    async (req, reply) => {
      const { id } = req.params;
      let outcome;
      try {
        outcome = await decideApproval(
          {
            store: deps.approvals,
            events: deps.events,
            unitOfWork: deps.unitOfWork,
            ...githubGuarded(deps),
            now: deps.now,
          },
          { id, decision, actor: "human:panel" },
        );
      } catch (err) {
        if (!(err instanceof GitHubFailure)) throw err;
        logError(deps.log, "github call failed", req, err);
        return reply.code(502).send({ error: "Falha ao consultar o GitHub." });
      }
      if (outcome.kind !== "unknown" && outcome.kind !== "already_decided") {
        const rec = deps.approvals.get(id);
        if (rec !== null) {
          applyInputs(deps, {
            projectId: rec.projectId,
            issueId: rec.issueId,
            inputs: outcome.inputs,
            actor: "human:panel",
          });
        }
      }
      const body =
        outcome.kind === "merged"
          ? { outcome: "merged", sha: outcome.sha }
          : { outcome: outcome.kind };
      return reply.code(OUTCOME_STATUS[outcome.kind]).send(body);
    },
  );
}
