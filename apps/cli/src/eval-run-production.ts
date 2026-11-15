import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSandboxVariantRunner,
  type AgentRuntime,
  type GitHost,
  type GitHubPort,
  type ReviewCredential,
  type ToolDenialSink,
  type VariantRunner,
  type WorktreeManager,
} from "@friday/application";
import {
  createRedactor,
  mirrorDirOf,
  prHeadReader,
  readReviewCredential,
  targetUrlOf,
  type TokenProviderFactory,
} from "@friday/daemon";
import {
  ClaudeAgentSdkRuntime,
  GitCliHost,
  GitHubRestAdapter,
  GitWorktreeManager,
  createGitHubClient,
  createInstallationTokenProvider,
  createResultStore,
  createRunLookup,
  createRunRepository,
  readContextPack,
  type ClaudeAgentSdkRuntimeDeps,
  type FridayDatabase,
  type GitCliHostOptions,
  type GitWorktreeManagerDeps,
} from "@friday/infrastructure";
import { projectIdOf } from "./daemon-values.ts";
import { openEvalDatabase } from "./eval-run-database.ts";
import { createMemoryStaleVerdicts } from "./eval-memory-stale.ts";
import { redactedError } from "./eval-redacted-error.ts";
import { checkProduction, type CheckedProduction } from "./eval-run-checks.ts";
import { createJudgeStepRunner } from "./eval-session-judge.ts";
import { createRunSessionFactory, type JudgeStepRunner } from "./eval-session.ts";

/** Label that #533 puts on the nine pilot issues of the sandbox (D114 item 2). */
export const EXPERIMENT_LABEL = "experimento-d112";

type Repo = { owner: string; repo: string };

export type ProductionInput = {
  registryRoot: string;
  env: Record<string, string | undefined>;
  homeDir: string;
  now: () => number;
  criteriaById: ReadonlyMap<string, readonly string[]>;
};

export type ProductionSeams = {
  createRuntime?: (deps: ClaudeAgentSdkRuntimeDeps) => AgentRuntime;
  createWorktrees?: (deps: GitWorktreeManagerDeps) => WorktreeManager;
  createGitHost?: (options: GitCliHostOptions) => GitHost;
  createGitHub?: (token: string, repo: Repo) => GitHubPort;
  readReview?: (root: string) => ReviewCredential | null;
  newRunId?: () => string;
  tmpRoot?: string;
  /** Where the denied tools are logged (D111); the default is stderr. */
  log?: (message: string) => void;
};

type Seams = Required<ProductionSeams>;

const defaultProvider: TokenProviderFactory = (input) =>
  createInstallationTokenProvider({ ...input, now: Date.now, fetch: globalThis.fetch });

function withDefaults(seams: ProductionSeams): Seams {
  return {
    createRuntime: seams.createRuntime ?? ((d) => new ClaudeAgentSdkRuntime(d)),
    createWorktrees: seams.createWorktrees ?? ((d) => new GitWorktreeManager(d)),
    createGitHost: seams.createGitHost ?? ((o) => new GitCliHost(o)),
    createGitHub:
      seams.createGitHub ??
      ((token, repo) => new GitHubRestAdapter(createGitHubClient(token), repo)),
    readReview: seams.readReview ?? ((root) => readReviewCredential(root, defaultProvider)),
    newRunId: seams.newRunId ?? randomUUID,
    tmpRoot: seams.tmpRoot ?? tmpdir(),
    log: seams.log ?? ((message) => void process.stderr.write(message + "\n")),
  };
}

function redactingJudge(judge: JudgeStepRunner, redact: (text: string) => string): JudgeStepRunner {
  return (input) =>
    judge(input).catch((error: unknown) => {
      throw redactedError(error, redact);
    });
}

function redactingRunner(runner: VariantRunner, redact: (text: string) => string): VariantRunner {
  return {
    run: (request) =>
      runner.run(request).catch((error: unknown) => {
        throw redactedError(error, redact);
      }),
  };
}

function redactorOf(input: ProductionInput, checked: CheckedProduction): (text: string) => string {
  const names = [checked.authorTokenEnv];
  if (checked.review.mode === "env") names.push(checked.review.tokenEnv);
  return createRedactor(input.env, names);
}

type Wiring = {
  input: ProductionInput;
  seams: Seams;
  checked: CheckedProduction;
  github: GitHubPort;
  gitHost: GitHost;
  worktrees: WorktreeManager;
  db: FridayDatabase;
  redact: (text: string) => string;
};

function judgeOf(w: Wiring, repo: Repo): JudgeStepRunner {
  const { input, checked } = w;
  const judge = createJudgeStepRunner({
    projectId: projectIdOf(checked.config.repository),
    configRoot: input.registryRoot,
    stale: createMemoryStaleVerdicts(),
    readPrHead: prHeadReader(w.github),
    reviewer: (token) => w.seams.createGitHub(token, repo),
    env: input.env,
    review: checked.review,
    agents: checked.judges,
  });
  return redactingJudge(judge, w.redact);
}

/**
 * Logs each denied tool with the tokens masked. The log is written at once, so it survives the
 * `close()` that deletes the temporary database; the runtime already dedupes by `toolUseId`.
 */
function denialLogOf(w: Wiring): ToolDenialSink {
  return {
    record: ({ toolName, toolUseId }) =>
      w.seams.log(w.redact(`Ferramenta negada: ${toolName} (${toolUseId})`)),
  };
}

function runnerOf(w: Wiring): VariantRunner {
  const { input, checked } = w;
  const { owner, name, base } = checked.config.repository;
  const runtime = w.seams.createRuntime({
    env: input.env,
    runs: createRunLookup(w.db),
    results: createResultStore(w.db),
    github: w.github,
    gitHost: w.gitHost,
    sink: denialLogOf(w),
  });
  const sessions = createRunSessionFactory({
    worktrees: w.worktrees,
    worktreesRoot: join(checked.paths.root, "worktrees"),
    project: `${owner}__${name}`,
    projectId: projectIdOf(checked.config.repository),
    base,
    configRoot: input.registryRoot,
    runTag: input.now().toString(36),
    runtime,
    runs: createRunRepository(w.db),
    agents: { roles: checked.roles, qa: checked.qa },
    screenPaths: checked.config.flow.screen_paths,
    readPrHead: prHeadReader(w.github),
    judge: judgeOf(w, { owner, repo: name }),
    newRunId: w.seams.newRunId,
    now: input.now,
  });
  const runner = createSandboxVariantRunner({
    issues: { list: () => w.github.listIssuesByLabel(EXPERIMENT_LABEL) },
    criteriaById: input.criteriaById,
    contextPack: (area) => readContextPack(input.registryRoot, area),
    sessions,
    now: input.now,
  });
  return redactingRunner(runner, w.redact);
}

/** Builds the real pieces; an error here is masked by `compose`, a failed wiring closes the store. */
function wire(
  input: ProductionInput,
  seams: Seams,
  checked: CheckedProduction,
  redact: (text: string) => string,
): { runner: VariantRunner; close(): void } {
  const { repository } = checked.config;
  const github = seams.createGitHub(checked.authorToken, {
    owner: repository.owner,
    repo: repository.name,
  });
  const gitHost = seams.createGitHost({
    tokenEnv: checked.authorTokenEnv,
    repoDir: checked.paths.repoDir,
    mirrorDir: mirrorDirOf({ env: input.env, homeDir: input.homeDir, repository }),
    targetUrl: targetUrlOf(repository),
    env: input.env,
  });
  const worktrees = seams.createWorktrees({ repoDir: checked.paths.repoDir });
  const store = openEvalDatabase(seams.tmpRoot, projectIdOf(repository));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    store.close();
  };
  try {
    const wiring = { input, seams, checked, github, gitHost, worktrees, db: store.db, redact };
    return { runner: runnerOf(wiring), close };
  } catch (error) {
    try {
      close();
    } catch {
      // the error of the wiring prevails over any error of the cleanup
    }
    throw error;
  }
}

function compose(input: ProductionInput, seams: Seams): { runner: VariantRunner; close(): void } {
  // Every check runs before any token is used, any adapter is built or the database is opened.
  const checked = checkProduction(input, seams.readReview);
  const redact = redactorOf(input, checked);
  try {
    return wire(input, seams, checked, redact);
  } catch (error) {
    // Adapters, database and wiring may carry the author or review token in their errors.
    throw redactedError(error, redact);
  }
}

/**
 * The production composition of the experiment runner (#552): the safety checks of
 * `eval-run-checks.ts`, then the author's GitHub, git host and worktrees, a temporary SQLite
 * with the project row, the Claude runtime, the metered sessions and the Judge.
 * `close()` closes the database and removes its folder; calling it twice is safe.
 */
export function createProductionRunner(
  input: ProductionInput,
  seams: ProductionSeams = {},
): Promise<{ runner: VariantRunner; close(): void }> {
  try {
    return Promise.resolve(compose(input, withDefaults(seams)));
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}
