import type {
  EventStore,
  IssueRepository,
  RunRecord,
  RunRepository,
  StateChangedPayload,
  WorktreeError,
  WorktreeManager,
} from "@friday/application";
import { transition } from "@friday/domain";
import { snapshotOf } from "./run-recorder.ts";

export type ReconcileDeps = {
  projectId: string;
  root: string;
  runs: RunRepository;
  issues: IssueRepository;
  events: EventStore;
  worktrees: WorktreeManager;
  now: () => Date;
};

export type ReconcileReport = {
  canceledRuns: string[];
  heldIssues: number[];
  removedWorktrees: number[];
  worktreeErrors: WorktreeError[];
};

/** Records `RunHeld(Reconciled)` for the run's issue; false when the issue cannot be held. */
function holdIssue(deps: ReconcileDeps, run: RunRecord): boolean {
  const { projectId, issues, events, now } = deps;
  const row = issues.get(projectId, run.issueId);
  if (row === null) return false;
  const snapshot = snapshotOf(row);
  if (snapshot === null) return false;
  const outcome = transition(snapshot, { type: "RunHeld", reason: "Reconciled" });
  if (!outcome.ok || outcome.value.event === null) return false;
  const { snapshot: after, event } = outcome.value;
  const payload: StateChangedPayload = {
    ...event,
    verifyRound: after.verifyRound,
    qaRound: after.qaRound,
    reviewIter: after.reviewIter,
  };
  events.append({
    projectId,
    issueId: run.issueId,
    runId: run.id,
    type: "StateChanged",
    payload,
    actor: "daemon",
    at: now().toISOString(),
  });
  issues.rebuild(projectId);
  return true;
}

async function removeOrphans(deps: ReconcileDeps, report: ReconcileReport): Promise<void> {
  const { worktrees, root, projectId, runs } = deps;
  const activeIssues = runs.listActive(projectId).map((r) => r.issueId);
  const orphans = await worktrees.listOrphans({ root, project: projectId, activeIssues });
  if (!orphans.ok) {
    report.worktreeErrors.push(orphans.error);
    return;
  }
  for (const { issue } of orphans.value) {
    const removed = await worktrees.remove({ root, project: projectId, issue });
    if (removed.ok) report.removedWorktrees.push(issue);
    else report.worktreeErrors.push(removed.error);
  }
}

/** Runs once after a restart: cancels runs the previous process left active (D51, D57). */
export async function reconcile(deps: ReconcileDeps): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    canceledRuns: [],
    heldIssues: [],
    removedWorktrees: [],
    worktreeErrors: [],
  };
  for (const run of deps.runs.listActive(deps.projectId)) {
    if (holdIssue(deps, run)) report.heldIssues.push(run.issueId);
    deps.runs.save({
      ...run,
      status: "canceled_by_reconciliation",
      finishedAt: deps.now().toISOString(),
    });
    report.canceledRuns.push(run.id);
  }
  await removeOrphans(deps, report);
  return report;
}
