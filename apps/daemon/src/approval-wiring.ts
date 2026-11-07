import {
  requestApproval,
  type ApprovalStore,
  type EventStore,
  type IssueRepository,
  type UnitOfWork,
} from "@friday/application";
import type { Risk, WorkflowInput } from "@friday/domain";
import { applyInput } from "./run-recorder.ts";

export type ApprovalDeps = {
  store: ApprovalStore;
  unitOfWork: UnitOfWork;
  headOf: (pr: number) => Promise<string>;
  prMergeStateOf: (pr: number) => Promise<{ merged: boolean; headSha: string }>;
  newId: () => string;
};

export type ApprovalContext = {
  projectId: string;
  events: EventStore;
  issues: IssueRepository;
  now: () => Date;
  log?: (message: string) => void;
  approval: ApprovalDeps;
  prOf: (issueId: number) => number | null;
  tierOf: (pr: number) => Promise<Risk | null>;
};

type RiskDecision = { risk: Risk; autoMerge: boolean };

/** True when the risk decision leads to AwaitingApproval instead of Merging. */
export function needsApproval(decision: RiskDecision): boolean {
  return !(decision.risk === "low" && decision.autoMerge);
}

/** Reads the PR head before RiskAssessed is applied; a failure leaves the issue in RiskCheck. */
export function headForApproval(
  approval: ApprovalDeps,
  pr: number,
  decision: RiskDecision,
): Promise<string> | null {
  return needsApproval(decision) ? approval.headOf(pr) : null;
}

/** Records the approval request once RiskAssessed was accepted. */
export function recordApprovalRequest(
  ctx: ApprovalContext,
  input: { issueId: number; pr: number; headSha: string; tier: Risk },
): void {
  const { approval } = ctx;
  requestApproval(
    {
      store: approval.store,
      events: ctx.events,
      unitOfWork: approval.unitOfWork,
      now: () => ctx.now().getTime(),
      newId: approval.newId,
    },
    { projectId: ctx.projectId, ...input },
  );
}

function apply(ctx: ApprovalContext, issueId: number, input: WorkflowInput): boolean {
  return applyInput(
    { projectId: ctx.projectId, events: ctx.events, issues: ctx.issues, now: ctx.now },
    { issueId, runId: null },
    input,
  );
}

/** Recreates a lost request (D69): without a PR the issue is held; any failure retries next tick. */
async function recreateRequest(ctx: ApprovalContext, issueId: number): Promise<void> {
  const pr = ctx.prOf(issueId);
  if (pr === null) {
    apply(ctx, issueId, { type: "ApprovalExpired" });
    return;
  }
  try {
    const headSha = await ctx.approval.headOf(pr);
    const tier = await ctx.tierOf(pr);
    if (tier === null) {
      ctx.log?.(`Risco indisponível para recriar o pedido de aprovação da issue ${issueId}`);
      return;
    }
    recordApprovalRequest(ctx, { issueId, pr, headSha, tier });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    ctx.log?.(`Falha ao recriar o pedido de aprovação da issue ${issueId}: ${reason}`);
  }
}

/** Per tick, for an issue in AwaitingApproval: expires, denies or reconciles (D67) its request. */
export async function handleAwaitingApproval(ctx: ApprovalContext, issueId: number): Promise<void> {
  const latest = ctx.approval.store.latestForIssue(ctx.projectId, issueId);
  if (latest === null) {
    await recreateRequest(ctx, issueId);
    return;
  }
  if (latest.decision === "denied") {
    apply(ctx, issueId, { type: "ApprovalDenied" });
    return;
  }
  if (latest.decision === null) {
    if (ctx.now().getTime() >= latest.expiresAt) apply(ctx, issueId, { type: "ApprovalExpired" });
    return;
  }
  if (latest.decidedAt === null) {
    ctx.log?.(`O pedido de aprovação ${latest.id} da issue ${issueId} está aprovado sem decidedAt`);
    return;
  }
  const state = await ctx.approval.prMergeStateOf(latest.pr);
  const granted = apply(ctx, issueId, {
    type: "ApprovalGranted",
    headSha: latest.headSha,
    prHeadSha: latest.headSha,
    decidedAt: latest.decidedAt,
    expiresAt: latest.expiresAt,
  });
  if (!granted) return;
  const merged = state.merged && state.headSha === latest.headSha;
  apply(ctx, issueId, { type: merged ? "Merged" : "MergeBlocked" });
}
