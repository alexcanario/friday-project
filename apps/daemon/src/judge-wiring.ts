import type {
  AgentRunOptions,
  AgentRuntime,
  GitHubPort,
  ReviewCredential,
} from "@friday/application";
import {
  SqliteStaleVerdicts,
  createInstallationTokenProvider,
  loadFactoryConfig,
} from "@friday/infrastructure";
import type { BudgetDeps } from "./budget-gate.ts";
import { runJudgeForIssue, prHeadReader, type JudgeApplyResult } from "./judge-dispatch.ts";
import type { RunRecorderDeps } from "./run-recorder.ts";
import type { RunRecordingDeps } from "./run-registration.ts";
import { readTickConfig } from "./tick-config.ts";

export type JudgeCompose = {
  base: string;
  agents: Record<"judge" | "judge-strong", AgentRunOptions>;
  input: (issueId: number, headSha: string) => { cwd: string; prompt: string; configRoot: string };
};

/** Builds the installation-token provider of one App (same shape as `ComposeOptions.createTokenProvider`). */
export type TokenProviderFactory = (input: {
  appId: number;
  installationId: number;
  privateKeyPath: string;
  permissions?: { pull_requests?: "write" | "read" };
}) => { getToken(): Promise<string> };

export type JudgeBranchDeps = {
  projectId: string;
  root: string;
  github: GitHubPort;
  reviewerFor: (token: string) => Pick<GitHubPort, "postReview">;
  compose: JudgeCompose;
  env: Record<string, string | undefined>;
  /** Provider of the review App; defaults to `createInstallationTokenProvider` (#379). */
  createTokenProvider?: TokenProviderFactory;
  runtime?: AgentRuntime;
  prOf: (issueId: number) => number | null;
  recorder: RunRecorderDeps;
  recording: RunRecordingDeps;
  budget: BudgetDeps;
  now: () => Date;
  log?: (message: string) => void;
};

/** Reads the review credential on every run (`review_app` or `review_token_env`); null when the config is unreadable. */
export function readReviewCredential(
  root: string,
  providerFor: TokenProviderFactory,
): ReviewCredential | null {
  const loaded = loadFactoryConfig(root);
  if (!loaded.ok) return null;
  const { review_app: app, review_token_env: tokenEnv } = loaded.config.pull_requests;
  if (app !== undefined) {
    const provider = providerFor({
      appId: app.app_id,
      installationId: app.installation_id,
      privateKeyPath: app.private_key_path,
      permissions: { pull_requests: "write" },
    });
    return { mode: "app", getToken: () => provider.getToken() };
  }
  return tokenEnv === undefined ? null : { mode: "env", tokenEnv };
}

const defaultProvider: TokenProviderFactory = (input) =>
  createInstallationTokenProvider({ ...input, now: Date.now, fetch: globalThis.fetch });

/** Memoizes providers per App/installation/key: the config is re-read per run, the renewal cache must survive. */
function memoized(create: TokenProviderFactory): TokenProviderFactory {
  const cache = new Map<string, ReturnType<TokenProviderFactory>>();
  return (input) => {
    const key = JSON.stringify([input.appId, input.installationId, input.privateKeyPath]);
    const found = cache.get(key);
    if (found !== undefined) return found;
    const created = create(input);
    cache.set(key, created);
    return created;
  };
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
  const providerFor = memoized(deps.createTokenProvider ?? defaultProvider);
  return (issueId) => {
    const config = readTickConfig(deps.root);
    const review = readReviewCredential(deps.root, providerFor);
    if (config === null || review === null) {
      deps.log?.(`Falha no Judge da issue ${issueId}: o factory.yaml está inválido ou ausente.`);
      return Promise.resolve({ applied: false, feedback: null });
    }
    return runJudgeForIssue(
      {
        projectId: deps.projectId,
        base: deps.compose.base,
        prOf: deps.prOf,
        getIssue,
        judgeInput: deps.compose.input,
        step: {
          ...(deps.runtime === undefined ? {} : { runtime: deps.runtime }),
          stale: new SqliteStaleVerdicts(deps.recorder.events, deps.now),
          env: deps.env,
          review,
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
