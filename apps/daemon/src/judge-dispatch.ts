import { randomUUID } from "node:crypto";
import {
  runJudgeStep,
  type AgentRuntime,
  type GitHubPort,
  type JudgeStepDeps,
  type JudgeStepOutcome,
} from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import { passesBudget, type BudgetCaps, type BudgetDeps } from "./budget-gate.ts";
import { judgeContextOf } from "./judge-context.ts";
import { judgeFridayOf } from "./judge-request.ts";
import { judgeRedactorOf } from "./redact.ts";
import { applyInput, type RunContext, type RunRecorderDeps } from "./run-recorder.ts";
import { baseRuntimeOf, statusFor, type RunRecordingDeps } from "./run-registration.ts";

export type JudgeApplyResult = { applied: boolean; feedback: string | null };

export type JudgeDispatchDeps = {
  projectId: string;
  /** The repository base branch (`repository.base`), for the effect tools' run. */
  base: string;
  prOf: (issueId: number) => number | null;
  getIssue: (issueId: number) => Promise<{ body: string; labels: string[] }>;
  judgeInput: (
    issueId: number,
    headSha: string,
  ) => { cwd: string; prompt: string; configRoot: string };
  step: Omit<JudgeStepDeps, "reviewer" | "readPrHead" | "runtime"> & { runtime?: AgentRuntime };
  readPrHead: JudgeStepDeps["readPrHead"];
  reviewerFor: JudgeStepDeps["reviewer"];
  recorder: RunRecorderDeps;
  recording: RunRecordingDeps;
  budget: BudgetDeps;
  caps: BudgetCaps;
  now: () => Date;
  log?: (message: string) => void;
};

const NOT_APPLIED: JudgeApplyResult = { applied: false, feedback: null };

/** Applies the Judge step outcome to the persisted issue state. */
export function applyJudgeOutcome(
  deps: RunRecorderDeps,
  ctx: { issueId: number; runId: string | null },
  outcome: JudgeStepOutcome,
): JudgeApplyResult {
  if (outcome.kind === "stale" || outcome.kind === "invalid") return NOT_APPLIED;
  if (!applyInput(deps, ctx, outcome.input)) return NOT_APPLIED;
  const feedback = outcome.kind === "changes_requested" ? outcome.feedback : null;
  return { applied: true, feedback };
}

/** Reads the current head of a pull request from its check status. */
export function prHeadReader(
  github: Pick<GitHubPort, "getCiStatus">,
): (pr: number) => Promise<string> {
  return async (pr) => (await github.getCiStatus(pr, "check")).headSha;
}

function redact(deps: JudgeDispatchDeps, message: string): string {
  // App mode has no value in `env`: the ghs_ pattern of redact.ts masks the token.
  const { review } = deps.step;
  const token = review.mode === "env" ? deps.step.env[review.tokenEnv] : undefined;
  if (token === undefined || token === "") return message;
  return message.replaceAll(token, "***");
}

function alreadySkippedAt(deps: JudgeDispatchDeps, issueId: number, head: string): boolean {
  return deps.recorder.events.list(deps.projectId, issueId).some((e) => {
    if (e.type !== "JudgeSkipped") return false;
    const payload = e.payload as { headSha?: unknown } | null;
    return payload?.headSha === head;
  });
}

function appendEvent(
  deps: JudgeDispatchDeps,
  issueId: number,
  runId: string | null,
  type: string,
  payload: unknown,
): void {
  deps.recorder.events.append({
    projectId: deps.projectId,
    issueId,
    runId,
    type,
    payload,
    actor: "daemon",
    at: deps.recorder.now().toISOString(),
  });
}

function skipPayload(outcome: JudgeStepOutcome, head: string) {
  if (outcome.kind === "head_mismatch") {
    return { reason: "head_mismatch", headSha: outcome.input.headSha };
  }
  if (outcome.kind === "stale" || outcome.kind === "invalid") {
    return { reason: outcome.kind, headSha: head };
  }
  return null;
}

type Execution = { outcome: JudgeStepOutcome };
type Tracker = { last: RunFinished | null };

/** Writes the ceiling as unknown cost; a failure here is only logged (redacted). */
function recordCeiling(deps: JudgeDispatchDeps, ctx: RunContext): void {
  try {
    deps.recording.recorder.recordUnknownCost(ctx);
  } catch (ledgerError) {
    deps.log?.(
      redact(deps, `Falha ao registrar o custo da run ${ctx.runId}: ${String(ledgerError)}`),
    );
  }
}

/** The run's runtime (from `runtimeFor` when present) wrapped to record every finished run. */
function recordingRuntime(
  deps: JudgeDispatchDeps,
  ctx: { runId: string; issueId: number },
  tracker: Tracker,
): AgentRuntime {
  const { recorder } = deps.recording;
  const base = baseRuntimeOf(deps.recording, ctx, deps.step.runtime);
  return {
    run: async (request) => {
      const runCtx = { ...ctx, maxBudgetUsd: request.agent.maxBudgetUsd };
      let finished: RunFinished;
      try {
        finished = await base.run(request);
      } catch (error) {
        recordCeiling(deps, runCtx);
        throw error;
      }
      tracker.last = finished;
      // D64: an invalid verdict becomes JudgeSkipped, not Held, so the ledger is written without RunHeld.
      recorder.recordFinished(runCtx, finished, {
        applyHeld: finished.status !== "invalid_output",
      });
      return finished;
    },
  };
}

/** The cwd, prompt and config root of the Judge run plus its `friday` MCP server. */
function stepTarget(
  deps: JudgeDispatchDeps,
  t: { issueId: number; pr: number; runId: string; head: string; context: string },
) {
  const input = deps.judgeInput(t.issueId, t.head);
  const target = {
    ...input,
    prompt: `${input.prompt}\n\n${t.context}`,
  };
  const friday = judgeFridayOf({
    projectId: deps.projectId,
    issueId: t.issueId,
    runId: t.runId,
    pr: t.pr,
    base: deps.base,
    cwd: target.cwd,
    issues: deps.recorder.issues,
  });
  return { ...target, friday };
}

/** Runs the judge step with a registered run row and a recording runtime. */
async function execute(
  deps: JudgeDispatchDeps,
  issueId: number,
  pr: number,
  runId: string,
  head: string,
  context: string,
): Promise<Execution> {
  const { runs } = deps.recording;
  const row = {
    id: runId,
    projectId: deps.projectId,
    issueId,
    phase: null,
    startedAt: deps.now().toISOString(),
    finishedAt: null,
  };
  runs.save({ ...row, status: "running" });
  const tracker: Tracker = { last: null };
  let completed = false;
  try {
    const runtime = recordingRuntime(deps, { runId, issueId }, tracker);
    const issue = await deps.getIssue(issueId);
    const outcome = await runJudgeStep(
      { ...deps.step, runtime, readPrHead: deps.readPrHead, reviewer: deps.reviewerFor },
      {
        projectId: deps.projectId,
        issue: { id: issueId, ...issue },
        pr,
        ...stepTarget(deps, { issueId, pr, runId, head, context }),
      },
    );
    completed = outcome.kind !== "held";
    return { outcome };
  } finally {
    const finished = tracker.last;
    const status = completed && finished !== null ? statusFor(finished) : "failed";
    try {
      runs.save({ ...row, status, finishedAt: deps.now().toISOString() });
    } catch (error) {
      deps.log?.(redact(deps, `Falha ao fechar a run ${runId}: ${String(error)}`));
    }
  }
}

function record(
  deps: JudgeDispatchDeps,
  issueId: number,
  runId: string,
  head: string,
  outcome: JudgeStepOutcome,
): JudgeApplyResult {
  const result = applyJudgeOutcome(deps.recorder, { issueId, runId }, outcome);
  const skip = skipPayload(outcome, head);
  if (skip !== null) appendEvent(deps, issueId, runId, "JudgeSkipped", skip);
  if (result.applied && result.feedback !== null && outcome.kind === "changes_requested") {
    appendEvent(deps, issueId, runId, "JudgeFinished", {
      outcome: "changes_requested",
      feedback: result.feedback,
      reviewId: outcome.reviewId,
    });
  }
  return result;
}

/** The Judge context of the head, or null after logging and recording JudgeSkipped (fail closed, D104). */
function contextOrSkip(deps: JudgeDispatchDeps, issueId: number, head: string): string | null {
  const events = deps.recorder.events.list(deps.projectId, issueId);
  const context = judgeContextOf(events, head, judgeRedactorOf(deps.step.env, deps.step.review));
  if (context !== null) return context;
  deps.log?.(
    `O Judge da issue ${issueId} não roda: faltam os critérios ou o relatório do QA do head ${head}`,
  );
  appendEvent(deps, issueId, null, "JudgeSkipped", { reason: "context_missing", headSha: head });
  return null;
}

/** Runs the Judge for an issue in review, posts the review and records the verdict. Never rejects. */
export async function runJudgeForIssue(
  deps: JudgeDispatchDeps,
  issueId: number,
): Promise<JudgeApplyResult> {
  const runId = (deps.recording.newRunId ?? randomUUID)();
  try {
    const pr = deps.prOf(issueId);
    if (pr === null) {
      deps.log?.(`A issue ${issueId} em InReview não tem PR associado`);
      return NOT_APPLIED;
    }
    const head = await deps.readPrHead(pr);
    if (alreadySkippedAt(deps, issueId, head)) {
      deps.log?.(`O Judge já ignorou o head ${head} da issue ${issueId}`);
      return NOT_APPLIED;
    }
    const context = contextOrSkip(deps, issueId, head);
    if (context === null) return NOT_APPLIED;
    // The same run may call `judge` and then `judge-strong`, so the ceiling is the sum of both.
    const { agents } = deps.step;
    const allowed = passesBudget(
      deps.budget,
      deps.caps,
      {
        projectId: deps.projectId,
        issueId,
        runCeilingUsd: agents.judge.maxBudgetUsd + agents["judge-strong"].maxBudgetUsd,
        nowMs: deps.now().getTime(),
      },
      deps.log ?? (() => {}),
    );
    if (!allowed) return NOT_APPLIED;
    const { outcome } = await execute(deps, issueId, pr, runId, head, context);
    return record(deps, issueId, runId, head, outcome);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    deps.log?.(redact(deps, `Falha no Judge da issue ${issueId}: ${text}`));
    return NOT_APPLIED;
  }
}
