import type { GitHubPort } from "@friday/application";
import {
  createApprovalStore,
  createUnitOfWork,
  generateApprovalId,
  type FridayDatabase,
} from "@friday/infrastructure";
import type { ApprovalDeps } from "./approval-wiring.ts";

/** Builds the approval dependencies over the shared database and the authenticated GitHub port. */
export function createApprovalDeps(opts: {
  db: FridayDatabase;
  github: Pick<GitHubPort, "getPrMergeState">;
  newId?: () => string;
}): ApprovalDeps {
  const { db, github } = opts;
  return {
    store: createApprovalStore(db),
    unitOfWork: createUnitOfWork(db),
    headOf: async (pr) => (await github.getPrMergeState(pr)).headSha,
    prMergeStateOf: (pr) => github.getPrMergeState(pr),
    newId: opts.newId ?? generateApprovalId,
  };
}
