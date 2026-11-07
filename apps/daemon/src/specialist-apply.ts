import type { SpecialistStepOutcome, StateChangedPayload } from "@friday/application";
import { transition, type WorkflowSnapshot } from "@friday/domain";
import { snapshotOf, type RunRecorderDeps } from "./run-recorder.ts";

type Change = NonNullable<Extract<ReturnType<typeof transition>, { ok: true }>["value"]["event"]>;

/**
 * Folds the outcome inputs in memory and records the final state change as a single
 * StateChanged. Records nothing when the row is missing or an input is refused.
 */
export function applySpecialistOutcome(
  deps: RunRecorderDeps,
  ctx: { issueId: number; runId: string | null },
  outcome: SpecialistStepOutcome,
): { applied: boolean } {
  const { projectId, events, issues, now } = deps;
  const row = issues.get(projectId, ctx.issueId);
  if (row === null) return { applied: false };
  let snapshot: WorkflowSnapshot | null = snapshotOf(row);
  if (snapshot === null) return { applied: false };
  let last: Change | null = null;
  for (const input of outcome.inputs) {
    const step = transition(snapshot, input);
    if (!step.ok) return { applied: false };
    snapshot = step.value.snapshot;
    if (step.value.event !== null) last = step.value.event;
  }
  if (last === null) return { applied: false };
  const payload: StateChangedPayload = {
    ...last,
    verifyRound: snapshot.verifyRound,
    qaRound: snapshot.qaRound,
    reviewIter: snapshot.reviewIter,
  };
  events.append({
    type: "StateChanged",
    projectId,
    issueId: ctx.issueId,
    runId: ctx.runId,
    actor: "daemon",
    at: now().toISOString(),
    payload,
  });
  issues.rebuild(projectId);
  return { applied: true };
}
