import { randomUUID } from "node:crypto";
import {
  runJudgeStep,
  type AgentRuntime,
  type GitHubPort,
  type JudgeStepDeps,
  type JudgeStepOutcome,
} from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import { applyInput, type RunRecorderDeps } from "./run-recorder.ts";
import { statusFor, type RunRecordingDeps } from "./run-registration.ts";

export type JudgeApplyResult = { applied: boolean; feedback: string | null };

export type JudgeDispatchDeps = {
  projectId: string;
  prOf: (issueId: number) => number | null;
  getIssue: (issueId: number) => Promise<{ body: string; labels: string[] }>;
  judgeInput: (issueId: number) => { cwd: string; prompt: string; configRoot: string };
  step: Omit<JudgeStepDeps, "reviewer" | "readPrHead">;
  readPrHead: JudgeStepDeps["readPrHead"];
  reviewerFor: JudgeStepDeps["reviewer"];
  recorder: RunRecorderDeps;
  recording: RunRecordingDeps;
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
  const name = deps.step.reviewTokenEnv;
  const token = name === undefined ? undefined : deps.step.env[name];
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
  runId: string,
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

/** Runs the judge step with a registered run row and a recording runtime. */
async function execute(
  deps: JudgeDispatchDeps,
  issueId: number,
  pr: number,
  runId: string,
): Promise<Execution> {
  const { runs, recorder } = deps.recording;
  const row = {
    id: runId,
    projectId: deps.projectId,
    issueId,
    phase: null,
    startedAt: deps.now().toISOString(),
    finishedAt: null,
  };
  runs.save({ ...row, status: "running" });
  let last: RunFinished | null = null;
  let completed = false;
  const runtime: AgentRuntime = {
    run: async (request) => {
      const finished = await deps.step.runtime.run(request);
      last = finished;
      // D64: an invalid verdict becomes JudgeSkipped, not Held, so only the event is recorded.
      if (finished.status === "invalid_output") {
        appendEvent(deps, issueId, runId, "RunFinished", finished);
      } else {
        recorder.recordFinished({ runId, issueId }, finished);
      }
      return finished;
    },
  };
  try {
    const issue = await deps.getIssue(issueId);
    const outcome = await runJudgeStep(
      { ...deps.step, runtime, readPrHead: deps.readPrHead, reviewer: deps.reviewerFor },
      {
        projectId: deps.projectId,
        issue: { id: issueId, ...issue },
        pr,
        ...deps.judgeInput(issueId),
      },
    );
    completed = outcome.kind !== "held";
    return { outcome };
  } finally {
    const finished: RunFinished | null = last;
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
    const { outcome } = await execute(deps, issueId, pr, runId);
    return record(deps, issueId, runId, head, outcome);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    deps.log?.(redact(deps, `Falha no Judge da issue ${issueId}: ${text}`));
    return NOT_APPLIED;
  }
}
