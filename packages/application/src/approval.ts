import type { Risk, WorkflowInput } from "@friday/domain";
import type { GitHubPort } from "./github-port.ts";
import type { EventStore, UnitOfWork } from "./persistence-ports.ts";

/** An approval request expires 30 minutes after it is made. */
export const APPROVAL_TTL_MS = 1_800_000;

export interface ApprovalRecord {
  id: string;
  projectId: string;
  issueId: number;
  pr: number;
  headSha: string;
  tier: Risk;
  requestedAt: number;
  expiresAt: number;
  decision: "approved" | "denied" | null;
  decidedAt: number | null;
  decidedBy: string | null;
}

export interface ApprovalStore {
  /** Throws when the id already exists. */
  insert(record: ApprovalRecord): void;
  get(id: string): ApprovalRecord | null;
  /** Undecided and `expiresAt > now`, ordered by `requestedAt` then `id`. */
  listPending(projectId: string, now: number): ApprovalRecord[];
  /** Newest by `requestedAt` (ties: highest `id`), including decided and expired ones. */
  latestForIssue(projectId: string, issueId: number): ApprovalRecord | null;
  /** Writes only while `decision` is still null; returns false otherwise. */
  decide(
    id: string,
    decision: { decision: "approved" | "denied"; decidedAt: number; decidedBy: string },
  ): boolean;
}

export type ApprovalOutcome =
  | { kind: "unknown" }
  | { kind: "already_decided" }
  | { kind: "denied"; inputs: WorkflowInput[] }
  | { kind: "expired"; inputs: WorkflowInput[] }
  | { kind: "head_changed"; inputs: WorkflowInput[] }
  | { kind: "merge_blocked"; inputs: WorkflowInput[] }
  | { kind: "merged"; sha: string; inputs: WorkflowInput[] };

export interface RequestApprovalDeps {
  store: ApprovalStore;
  events: EventStore;
  unitOfWork: UnitOfWork;
  now: () => number;
  newId: () => string;
}

export function requestApproval(
  deps: RequestApprovalDeps,
  input: { projectId: string; issueId: number; pr: number; headSha: string; tier: Risk },
): ApprovalRecord {
  const requestedAt = deps.now();
  const record: ApprovalRecord = {
    id: deps.newId(),
    ...input,
    requestedAt,
    expiresAt: requestedAt + APPROVAL_TTL_MS,
    decision: null,
    decidedAt: null,
    decidedBy: null,
  };
  deps.unitOfWork.run(() => {
    deps.store.insert(record);
    deps.events.append({
      projectId: record.projectId,
      issueId: record.issueId,
      runId: null,
      type: "ApprovalRequested",
      payload: {
        id: record.id,
        pr: record.pr,
        headSha: record.headSha,
        tier: record.tier,
        requestedAt: record.requestedAt,
        expiresAt: record.expiresAt,
      },
      actor: "daemon",
      at: new Date(requestedAt).toISOString(),
    });
  });
  return record;
}

export interface DecideApprovalDeps {
  store: ApprovalStore;
  events: EventStore;
  unitOfWork: UnitOfWork;
  github: Pick<GitHubPort, "squashMerge">;
  readPrHead: (pr: number) => Promise<string>;
  now: () => number;
}

type Decision = "approved" | "denied";

/** Persists the decision (only once) and appends the event; false when someone decided first. */
function record(
  deps: DecideApprovalDeps,
  rec: ApprovalRecord,
  decision: Decision,
  decidedAt: number,
  actor: string,
): boolean {
  return deps.unitOfWork.run(() => {
    if (!deps.store.decide(rec.id, { decision, decidedAt, decidedBy: actor })) return false;
    deps.events.append({
      projectId: rec.projectId,
      issueId: rec.issueId,
      runId: null,
      type: "ApprovalDecided",
      payload: { id: rec.id, decision, decidedAt },
      actor,
      at: new Date(deps.now()).toISOString(),
    });
    return true;
  });
}

export async function decideApproval(
  deps: DecideApprovalDeps,
  input: { id: string; decision: "approve" | "deny"; actor: string },
): Promise<ApprovalOutcome> {
  const rec = deps.store.get(input.id);
  if (rec === null) return { kind: "unknown" };
  if (rec.decision !== null) return { kind: "already_decided" };

  const decidedAt = deps.now();
  if (input.decision === "deny") {
    if (!record(deps, rec, "denied", decidedAt, input.actor)) return { kind: "already_decided" };
    return { kind: "denied", inputs: [{ type: "ApprovalDenied" }] };
  }

  const prHeadSha = await deps.readPrHead(rec.pr);
  const granted: WorkflowInput = {
    type: "ApprovalGranted",
    headSha: rec.headSha,
    prHeadSha,
    decidedAt,
    expiresAt: rec.expiresAt,
  };
  if (decidedAt >= rec.expiresAt) return { kind: "expired", inputs: [granted] };
  if (prHeadSha !== rec.headSha) return { kind: "head_changed", inputs: [granted] };

  if (!record(deps, rec, "approved", decidedAt, input.actor)) return { kind: "already_decided" };
  const merge = await deps.github.squashMerge(rec.pr, rec.headSha);
  if (!merge.merged) {
    return { kind: "merge_blocked", inputs: [granted, { type: "MergeBlocked" }] };
  }
  return { kind: "merged", sha: merge.sha, inputs: [granted, { type: "Merged" }] };
}
