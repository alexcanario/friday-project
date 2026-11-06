import {
  decideApproval,
  type ApprovalStore,
  type EventStore,
  type GitHubPort,
  type IssueRepository,
  type UnitOfWork,
} from "@friday/application";
import { applyInputs } from "./apply-inputs.ts";
import type { ApprovalsClient } from "./approvals.ts";

export type DirectClientDeps = {
  store: ApprovalStore;
  events: EventStore;
  unitOfWork: UnitOfWork;
  issues: IssueRepository;
  github: Pick<GitHubPort, "squashMerge">;
  readPrHead: (pr: number) => Promise<string>;
  now: () => number;
};

const ACTOR = "human:cli";

export function createDirectClient(deps: DirectClientDeps): ApprovalsClient {
  return {
    async list(project) {
      return deps.store.listPending(project, deps.now()).map((r) => ({
        id: r.id,
        issueId: r.issueId,
        pr: r.pr,
        headSha: r.headSha,
        tier: r.tier,
        requestedAt: r.requestedAt,
        expiresAt: r.expiresAt,
      }));
    },
    async decide(id, decision) {
      const outcome = await decideApproval(deps, { id, decision, actor: ACTOR });
      if (outcome.kind === "unknown" || outcome.kind === "already_decided") {
        return { kind: outcome.kind };
      }
      const rec = deps.store.get(id);
      if (rec !== null) {
        applyInputs(deps, { projectId: rec.projectId, issueId: rec.issueId }, outcome.inputs);
      }
      return outcome.kind === "merged"
        ? { kind: "merged", sha: outcome.sha }
        : { kind: outcome.kind };
    },
  };
}
