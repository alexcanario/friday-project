import type { StateChanged } from "@friday/domain";

export interface NewEvent {
  projectId: string;
  issueId: number | null;
  runId: string | null;
  type: string;
  payload: unknown;
  actor: string;
  at: string;
}

export interface StoredEvent extends NewEvent {
  seq: number;
}

/** Payload of a `StateChanged` event: the transition plus the snapshot counters after it. */
export interface StateChangedPayload extends StateChanged {
  verifyRound: number;
  qaRound: number;
  reviewIter: number;
}

/** Append-only: deliberately has no update or delete. */
export interface EventStore {
  append(event: NewEvent): StoredEvent;
  list(projectId: string, issueId: number): StoredEvent[];
}

export interface IssueRow {
  projectId: string;
  issueId: number;
  state: string;
  heldReason: string | null;
  verifyRound: number;
  qaRound: number;
  reviewIter: number;
}

export interface IssueRepository {
  get(projectId: string, issueId: number): IssueRow | null;
  /** Recreates the project's issues from its `StateChanged` events. */
  rebuild(projectId: string): void;
}

export interface RunRecord {
  id: string;
  projectId: string;
  issueId: number;
  phase: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunRepository {
  save(run: RunRecord): void;
  get(runId: string): RunRecord | null;
}

export interface LedgerEntry {
  projectId: string;
  runId: string;
  day: string;
  costUsd: number | null;
  costUnknown: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface DaySum {
  costUsd: number;
  anyCostUnknown: boolean;
}

export interface LedgerRepository {
  record(entry: LedgerEntry): void;
  sumByDay(projectId: string, day: string): DaySum;
}
