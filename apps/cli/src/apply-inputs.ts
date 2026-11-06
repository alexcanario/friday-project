import type {
  EventStore,
  IssueRepository,
  IssueRow,
  StateChangedPayload,
} from "@friday/application";
import {
  DEFAULT_PHASES,
  HELD_REASONS,
  ISSUE_STATES,
  transition,
  type WorkflowInput,
  type WorkflowSnapshot,
} from "@friday/domain";

export type ApplyInputsDeps = { events: EventStore; issues: IssueRepository; now: () => number };

function snapshotOf(row: IssueRow): WorkflowSnapshot | null {
  const state = ISSUE_STATES.find((s) => s === row.state);
  if (state === undefined) return null;
  let heldReason = null;
  if (row.heldReason !== null) {
    heldReason = HELD_REASONS.find((r) => r === row.heldReason) ?? null;
    if (heldReason === null) return null;
  }
  return {
    issueId: String(row.issueId),
    state,
    heldReason,
    verifyRound: row.verifyRound,
    qaRound: row.qaRound,
    reviewIter: row.reviewIter,
    phases: DEFAULT_PHASES,
    phaseIndex: 0,
  };
}

/** Applies the inputs in order as human:cli; stops without throwing on a refusal or a missing issue. */
export function applyInputs(
  deps: ApplyInputsDeps,
  ref: { projectId: string; issueId: number },
  inputs: WorkflowInput[],
): void {
  const { projectId, issueId } = ref;
  for (const input of inputs) {
    const row = deps.issues.get(projectId, issueId);
    if (row === null) return;
    const snapshot = snapshotOf(row);
    if (snapshot === null) return;
    const outcome = transition(snapshot, input);
    if (!outcome.ok) return;
    const { snapshot: after, event } = outcome.value;
    if (event === null) continue;
    const payload: StateChangedPayload = {
      ...event,
      verifyRound: after.verifyRound,
      qaRound: after.qaRound,
      reviewIter: after.reviewIter,
    };
    deps.events.append({
      type: "StateChanged",
      projectId,
      issueId,
      runId: null,
      actor: "human:cli",
      at: new Date(deps.now()).toISOString(),
      payload,
    });
    deps.issues.rebuild(projectId);
  }
}
