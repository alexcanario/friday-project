import { homedir } from "node:os";
import type { AgentRuntime, GitHost, GitHubPort, WorktreeManager } from "@friday/application";
import {
  GitCliHost,
  createBreakerStateRepository,
  createProjectEnabledRepository,
  createEventStore,
  createIssueRepository,
  createLedgerRepository,
  createRunRepository,
  openDatabase,
  type ClaudeAgentSdkRuntimeDeps,
  type FridayDatabase,
  type GitCliHostOptions,
} from "@friday/infrastructure";
import { authWiringOf, defaultGitHub } from "./compose-auth.ts";
import { createApprovalDeps } from "./approval-compose.ts";
import { createBreaker, type Breaker } from "./breaker.ts";
import {
  judgeBranchOf,
  qaBranchOf,
  specialistBranchOf,
  triageBranchOf,
  type BranchContext,
  type Repo,
} from "./compose-branches.ts";
import {
  assertSingleConcurrentRun,
  readDispatchConfig,
  readGuardedTickConfig,
  readAuthor,
  assertAppKeysReadable,
} from "./compose-config.ts";
import { assertQaAgentConfig, type QaCompose } from "./qa-wiring.ts";
import { assertSpecialistAgentConfig, type SpecialistCompose } from "./specialist-wiring.ts";
import { createPrOf } from "./pr-of.ts";
import { createIntake } from "./intake.ts";
import type { JudgeCompose } from "./judge-wiring.ts";
import { acquireProcessLock, type ProcessLockDeps } from "./process-lock.ts";
import { reconcile, type ReconcileReport } from "./reconcile.ts";
import { withRedactedLog } from "./redact.ts";
import { createRunRecorder } from "./run-recorder.ts";
import type { RunRecordingDeps } from "./run-registration.ts";
import { createStateDispatcher, type StateDispatcherDeps } from "./state-dispatcher.ts";
import { assertTriageAgentConfig, type TriageAgentConfig } from "./triage-request.ts";
import { createVerifyBranch } from "./verify-wiring.ts";
import { buildRuntimeFor, mirrorDirOf, targetUrlOf } from "./runtime-wiring.ts";
import { createTicker, type Clock, type Ticker } from "./tick.ts";

export interface ComposeOptions {
  root: string;
  /** Repository of the daemon (the same one the `GitWorktreeManager` works on). */
  repoDir: string;
  /** Directory the Verify worktreePath must stay inside; defaults to `root`. */
  worktreesRoot?: string;
  dbPath: string;
  projectId: string;
  env: Record<string, string | undefined>;
  worktrees: WorktreeManager;
  runtime?: AgentRuntime;
  /** Reads the PR of an issue; defaults to the last PrOpened event of the database (D71, D74). */
  prOf?: (issueId: number) => number | null;
  clock: Clock;
  lock?: ProcessLockDeps;
  now?: () => Date;
  log?: (message: string) => void;
  createGitHub?: (token: string, repo: Repo) => GitHubPort;
  /** Author GitHub port that asks `auth` for the token on every request (`author_app`, D89). */
  createGitHubWithAuth?: (auth: () => Promise<string>, repo: Repo) => GitHubPort;
  /** Installation-token provider of the author App; defaults to `createInstallationTokenProvider`. */
  createTokenProvider?: (input: {
    appId: number;
    installationId: number;
    privateKeyPath: string;
  }) => { getToken(): Promise<string> };
  /** Home directory used when FRIDAY_HOME is not set; defaults to os.homedir(). */
  homeDir?: string;
  createRuntime?: (deps: ClaudeAgentSdkRuntimeDeps) => AgentRuntime;
  createGitHost?: (options: GitCliHostOptions) => GitHost;
  /** Role request builders; empty in production until the roles are wired. */
  roles?: StateDispatcherDeps["roles"];
  /** Approval id generator; defaults to 8 lowercase hexadecimals (D65). */
  newApprovalId?: () => string;
  /** Judge agents and input; without it InReview is not dispatched (D64, D73). */
  judge?: JudgeCompose;
  /** QA ficha and context; without it QA is not dispatched (D70, D75). */
  qa?: QaCompose;
  specialist?: SpecialistCompose;
  /** Triage limits; without it Todo issues are left alone. */
  triage?: TriageAgentConfig;
}

export interface Daemon {
  ticker: Ticker;
  db: FridayDatabase;
  report: ReconcileReport;
  /** Releases the process lock and closes the database. */
  release(): void;
}

/** Builds the breaker from the persisted state; unreadable state fails closed. */
function buildBreaker(db: FridayDatabase, projectId: string, now: () => Date): Breaker {
  try {
    return createBreaker({
      now,
      threshold: 3,
      windowMs: 900000,
      openMs: 1800000,
      persist: { store: createBreakerStateRepository(db), projectId },
    });
  } catch {
    throw new Error("O estado do breaker está ilegível ou corrompido.");
  }
}

type DispatcherContext = BranchContext & {
  db: FridayDatabase;
  issues: ReturnType<typeof createIssueRepository>;
  events: ReturnType<typeof createEventStore>;
};

function dispatcherOf(opts: ComposeOptions, ctx: DispatcherContext) {
  const { db, github, issues, events, recorderDeps, now } = ctx;
  const { root, projectId } = opts;
  return createStateDispatcher({
    ...judgeBranchOf(opts, ctx),
    ...qaBranchOf(opts, ctx),
    ...specialistBranchOf(opts, ctx),
    ...triageBranchOf(opts, ctx),
    projectId,
    github,
    issues,
    events,
    roles: opts.roles ?? {},
    readConfig: () => readDispatchConfig(root),
    prOf: ctx.prOf,
    now,
    approval: createApprovalDeps({
      db,
      github,
      ...(opts.newApprovalId === undefined ? {} : { newId: opts.newApprovalId }),
    }),
    ...(opts.log === undefined ? {} : { log: opts.log }),
    verify: createVerifyBranch({
      projectId,
      recorder: recorderDeps,
      root,
      repoDir: opts.repoDir,
      ...(opts.worktreesRoot === undefined ? {} : { worktreesRoot: opts.worktreesRoot }),
      env: opts.env,
      ...(opts.log === undefined ? {} : { log: opts.log }),
    }),
  });
}

function ingestingIssues(
  opts: ComposeOptions,
  intake: ReturnType<typeof createIntake>,
  dispatcher: ReturnType<typeof dispatcherOf>,
) {
  return {
    listReady: async (capacity?: { active: number; max: number }) => {
      await intake.ingest().catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        opts.log?.(`Failed to ingest issues: ${detail}`);
      });
      return dispatcher.listReady(capacity);
    },
    busy: () => dispatcher.busy(),
  };
}

function tickerOf(opts: ComposeOptions, ctx: DispatcherContext, breaker: Breaker): Ticker {
  const { events, recording, budget, recorderDeps } = ctx;
  const dispatcher = dispatcherOf(opts, ctx);
  const intake = createIntake({
    projectId: opts.projectId,
    github: ctx.github,
    issues: ctx.issues,
    events,
    now: ctx.now,
    ...(opts.log === undefined ? {} : { log: opts.log }),
  });
  return createTicker({
    projectId: opts.projectId,
    clock: opts.clock,
    readConfig: () => readGuardedTickConfig(opts.root, opts.log),
    issues: ingestingIssues(opts, intake, dispatcher),
    buildRequest: (id, runId) => dispatcher.buildRequest(id, runId),
    ...(opts.runtime === undefined ? {} : { runtime: opts.runtime }),
    events,
    ...(opts.log === undefined ? {} : { log: opts.log }),
    recording,
    budget,
    breaker: { breaker, recorderDeps },
    enabled: createProjectEnabledRepository(ctx.db),
  });
}

async function assemble(
  opts: ComposeOptions,
  db: FridayDatabase,
  github: GitHubPort,
  runtimeFor: NonNullable<RunRecordingDeps["runtimeFor"]>,
  repo: Repo,
) {
  const { root, projectId, worktrees } = opts;
  const now = opts.now ?? (() => new Date());
  const issues = createIssueRepository(db);
  const events = createEventStore(db);
  const runs = createRunRepository(db);
  db.sqlite.prepare("INSERT OR IGNORE INTO projects (id) VALUES (?)").run(projectId);
  const breaker = buildBreaker(db, projectId, now);
  const ledger = createLedgerRepository(db);
  const recorderDeps = { projectId, events, issues, now };
  const report = await reconcile({
    projectId,
    root,
    runs,
    ...(opts.worktreesRoot === undefined ? {} : { worktreesRoot: opts.worktreesRoot }),
    issues,
    events,
    worktrees,
    now,
  });
  const recorder = createRunRecorder({ ...recorderDeps, ledger });
  const ctx = {
    db,
    github,
    repo,
    clientFor: opts.createGitHub ?? defaultGitHub,
    recorderDeps,
    recording: { runs, recorder, runtimeFor },
    budget: { ledger, recorderDeps },
    now,
    issues,
    events,
    prOf: opts.prOf ?? createPrOf(events, projectId),
  };
  return { ticker: tickerOf(opts, ctx, breaker), report };
}

/** Process composition at startup: lock, database, reconcile, GitHub, intake and ticker. */
export async function composeDaemon(opts: ComposeOptions): Promise<Daemon> {
  const author = readAuthor(opts);
  assertAppKeysReadable(opts.root, author);
  const { repo, repository } = author;
  opts = withRedactedLog(opts, author.tokenEnvNames);
  assertSingleConcurrentRun(opts.root);
  if (opts.qa !== undefined) assertQaAgentConfig(opts.qa.agent);
  if (opts.specialist !== undefined) assertSpecialistAgentConfig(opts.specialist.agent);
  if (opts.triage !== undefined) assertTriageAgentConfig(opts.triage);
  const wiring = authWiringOf(opts, author);
  const gitHost = (opts.createGitHost ?? ((o) => new GitCliHost(o)))({
    ...wiring.git,
    repoDir: opts.repoDir,
    mirrorDir: mirrorDirOf({ env: opts.env, homeDir: opts.homeDir ?? homedir(), repository }),
    targetUrl: targetUrlOf(repository),
    env: opts.env,
  });
  const lock = acquireProcessLock(opts.root, opts.lock);
  let db: FridayDatabase | undefined;
  try {
    db = openDatabase(opts.dbPath);
    const github = wiring.github();
    const runtimeFor = buildRuntimeFor({
      db,
      github,
      gitHost,
      env: opts.env,
      ...(opts.createRuntime === undefined ? {} : { createRuntime: opts.createRuntime }),
    });
    const { ticker, report } = await assemble(opts, db, github, runtimeFor, repo);
    const opened = db;
    return {
      ticker,
      db: opened,
      report,
      release() {
        try {
          lock.release();
        } finally {
          opened.close();
        }
      },
    };
  } catch (error) {
    db?.close();
    lock.release();
    throw error;
  }
}
