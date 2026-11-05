import type { RunFinished } from "@friday/contracts";
import {
  heldReasonFor,
  type EventStore,
  type IssueRepository,
  type IssueRow,
  type StateChangedPayload,
  type ToolDenialSink,
} from "@friday/application";
import {
  DEFAULT_PHASES,
  HELD_REASONS,
  ISSUE_STATES,
  transition,
  type HeldReason,
  type IssueState,
  type RunHeldReason,
  type WorkflowSnapshot,
} from "@friday/domain";

export type RunRecorderDeps = {
  projectId: string;
  events: EventStore;
  issues: IssueRepository;
  now: () => Date;
};

export type RunContext = { runId: string; issueId: number };

export type RunRecorder = {
  recordFinished(ctx: RunContext, finished: RunFinished): void;
  denialSink(ctx: RunContext): ToolDenialSink;
};

export function snapshotOf(row: IssueRow): WorkflowSnapshot | null {
  const state = ISSUE_STATES.find((s) => s === row.state);
  if (state === undefined) return null;
  let heldReason: HeldReason | null = null;
  if (row.heldReason !== null) {
    heldReason = HELD_REASONS.find((r) => r === row.heldReason) ?? null;
    if (heldReason === null) return null;
  }
  return {
    issueId: String(row.issueId),
    state: state satisfies IssueState,
    heldReason,
    verifyRound: row.verifyRound,
    qaRound: row.qaRound,
    reviewIter: row.reviewIter,
    phases: DEFAULT_PHASES,
    phaseIndex: 0,
  };
}

export function createRunRecorder(deps: RunRecorderDeps): RunRecorder {
  const { projectId, events, issues, now } = deps;
  const base = (ctx: RunContext) => ({
    projectId,
    issueId: ctx.issueId,
    runId: ctx.runId,
    actor: "daemon",
    at: now().toISOString(),
  });

  function applyHeld(ctx: RunContext, reason: RunHeldReason): void {
    const row = issues.get(projectId, ctx.issueId);
    if (row === null) return;
    const snapshot = snapshotOf(row);
    if (snapshot === null) return;
    const outcome = transition(snapshot, { type: "RunHeld", reason });
    if (!outcome.ok || outcome.value.event === null) return;
    const { snapshot: after, event } = outcome.value;
    const payload: StateChangedPayload = {
      ...event,
      verifyRound: after.verifyRound,
      qaRound: after.qaRound,
      reviewIter: after.reviewIter,
    };
    events.append({ ...base(ctx), type: "StateChanged", payload });
    issues.rebuild(projectId);
  }

  return {
    recordFinished(ctx, finished) {
      events.append({ ...base(ctx), type: "RunFinished", payload: finished });
      const reason = heldReasonFor(finished);
      if (reason !== null) applyHeld(ctx, reason);
    },
    denialSink(ctx) {
      const seen = new Set<string>();
      return {
        record({ toolName, toolUseId }) {
          if (toolUseId !== "" && seen.has(toolUseId)) return;
          events.append({ ...base(ctx), type: "ToolDenied", payload: { toolName, toolUseId } });
          if (toolUseId !== "") seen.add(toolUseId);
        },
      };
    },
  };
}
