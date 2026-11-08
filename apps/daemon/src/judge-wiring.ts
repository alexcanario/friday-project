import type { AgentRunOptions, AgentRuntime, GitHubPort } from "@friday/application";
import { SqliteStaleVerdicts, loadFactoryConfig } from "@friday/infrastructure";
import type { BudgetDeps } from "./budget-gate.ts";
import { runJudgeForIssue, prHeadReader, type JudgeApplyResult } from "./judge-dispatch.ts";
import type { RunRecorderDeps } from "./run-recorder.ts";
import type { RunRecordingDeps } from "./run-registration.ts";
import { readTickConfig } from "./tick-config.ts";

export type JudgeCompose = {
  agents: Record<"judge" | "judge-strong", AgentRunOptions>;
  input: (issueId: number) => { cwd: string; prompt: string; configRoot: string };
};

export type JudgeBranchDeps = {
  projectId: string;
  root: string;
  github: GitHubPort;
  reviewerFor: (token: string) => Pick<GitHubPort, "postReview">;
  compose: JudgeCompose;
  env: Record<string, string | undefined>;
  runtime: AgentRuntime;
  prOf: (issueId: number) => number | null;
  recorder: RunRecorderDeps;
  recording: RunRecordingDeps;
  budget: BudgetDeps;
  now: () => Date;
  log?: (message: string) => void;
};

/** Reads `pull_requests.review_token_env` on every run; undefined when absent or unreadable. */
function readReviewTokenEnv(root: string): string | undefined {
  const loaded = loadFactoryConfig(root);
  return loaded.ok ? loaded.config.pull_requests.review_token_env : undefined;
}

/** Builds the Judge branch of the dispatcher (D64); config is re-read on every execution. */
export function createJudgeBranch(
  deps: JudgeBranchDeps,
): (issueId: number) => Promise<JudgeApplyResult> {
  const getIssue = async (id: number): Promise<{ body: string; labels: string[] }> => {
    const found = (await deps.github.listIssuesByLabel("friday")).find((i) => i.number === id);
    if (found === undefined) throw new Error(`A issue ${id} não está na listagem do label friday.`);
    return { body: found.body, labels: found.labels };
  };
  return (issueId) => {
    const config = readTickConfig(deps.root);
    if (config === null) {
      deps.log?.(`Falha no Judge da issue ${issueId}: o factory.yaml está inválido ou ausente.`);
      return Promise.resolve({ applied: false, feedback: null });
    }
    return runJudgeForIssue(
      {
        projectId: deps.projectId,
        prOf: deps.prOf,
        getIssue,
        judgeInput: deps.compose.input,
        step: {
          runtime: deps.runtime,
          stale: new SqliteStaleVerdicts(deps.recorder.events, deps.now),
          env: deps.env,
          reviewTokenEnv: readReviewTokenEnv(deps.root),
          agents: deps.compose.agents,
        },
        readPrHead: prHeadReader(deps.github),
        reviewerFor: deps.reviewerFor,
        recorder: deps.recorder,
        recording: deps.recording,
        budget: deps.budget,
        caps: { perDayUsd: config.perDayUsd, perIssueUsd: config.perIssueUsd },
        now: deps.now,
        ...(deps.log === undefined ? {} : { log: deps.log }),
      },
      issueId,
    );
  };
}
