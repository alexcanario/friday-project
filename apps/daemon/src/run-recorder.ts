import type { RunFinished } from "@friday/contracts";
import {
  heldReasonFor,
  type EventStore,
  type IssueRepository,
  type IssueRow,
  type LedgerRepository,
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
  type WorkflowInput,
  type WorkflowSnapshot,
} from "@friday/domain";

export type RunRecorderDeps = {
  projectId: string;
  events: EventStore;
  issues: IssueRepository;
  now: () => Date;
  ledger?: LedgerRepository;
};

export type RunContext = { runId: string; issueId: number; maxBudgetUsd?: number };

export type RunRecorder = {
  recordFinished(ctx: RunContext, finished: RunFinished): void;
  /** Records the run ceiling as an unknown cost; used when the runtime threw. */
  recordUnknownCost(ctx: RunContext): void;
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

/** Transitions the stored issue with one input; records StateChanged and rebuilds when accepted. */
export function applyInput(
  deps: RunRecorderDeps,
  ctx: { issueId: number; runId: string | null },
  input: WorkflowInput,
): boolean {
  const { projectId, events, issues, now } = deps;
  const row = issues.get(projectId, ctx.issueId);
  if (row === null) return false;
  const snapshot = snapshotOf(row);
  if (snapshot === null) return false;
  const outcome = transition(snapshot, input);
  if (!outcome.ok || outcome.value.event === null) return false;
  const { snapshot: after, event } = outcome.value;
  const payload: StateChangedPayload = {
    ...event,
    verifyRound: after.verifyRound,
    qaRound: after.qaRound,
    reviewIter: after.reviewIter,
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
  return true;
}

export function createRunRecorder(deps: RunRecorderDeps): RunRecorder {
  const { projectId, events, now } = deps;
  const base = (ctx: RunContext) => ({
    projectId,
    issueId: ctx.issueId,
    runId: ctx.runId,
    actor: "daemon",
    at: now().toISOString(),
  });

  const ledgerBase = (ctx: RunContext) => ({
    projectId,
    issueId: ctx.issueId,
    runId: ctx.runId,
    day: now().toISOString().slice(0, 10),
  });

  function applyHeld(ctx: RunContext, reason: RunHeldReason): void {
    applyInput(deps, ctx, { type: "RunHeld", reason });
  }

  return {
    recordFinished(ctx, finished) {
      events.append({ ...base(ctx), type: "RunFinished", payload: finished });
      const unknown = finished.costUsd === null;
      const tokens = finished.tokens;
      deps.ledger?.record({
        ...ledgerBase(ctx),
        costUsd: unknown ? (ctx.maxBudgetUsd ?? null) : finished.costUsd,
        costUnknown: unknown,
        inputTokens: tokens?.input ?? 0,
        outputTokens: tokens?.output ?? 0,
        cacheReadTokens: tokens?.cacheRead ?? 0,
        cacheCreationTokens: tokens?.cacheCreation ?? 0,
        numTurns: finished.numTurns,
      });
      const reason = heldReasonFor(finished);
      if (reason !== null) applyHeld(ctx, reason);
    },
    recordUnknownCost(ctx) {
      deps.ledger?.record({
        ...ledgerBase(ctx),
        costUsd: ctx.maxBudgetUsd ?? null,
        costUnknown: true,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        numTurns: null,
      });
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
