import { homedir } from "node:os";
import type { AgentRuntime, GitHost, GitHubPort, WorktreeManager } from "@friday/application";
import {
  GitCliHost,
  GitHubRestAdapter,
  createBreakerStateRepository,
  createEventStore,
  createGitHubClient,
  createIssueRepository,
  createLedgerRepository,
  createRunRepository,
  loadFactoryConfig,
  openDatabase,
  type ClaudeAgentSdkRuntimeDeps,
  type FridayDatabase,
  type GitCliHostOptions,
} from "@friday/infrastructure";
import { createBreaker, type Breaker } from "./breaker.ts";
import { readDispatchConfig } from "./compose-config.ts";
import { createIntake } from "./intake.ts";
import { acquireProcessLock, type ProcessLockDeps } from "./process-lock.ts";
import { reconcile, type ReconcileReport } from "./reconcile.ts";
import { createRunRecorder } from "./run-recorder.ts";
import type { RunRecordingDeps } from "./run-registration.ts";
import { createStateDispatcher, type StateDispatcherDeps } from "./state-dispatcher.ts";
import { createTriageBranch } from "./triage-wiring.ts";
import { assertTriageFicha, type TriageFicha } from "./triage-request.ts";
import { createVerifyBranch } from "./verify-wiring.ts";
import { readTickConfig } from "./tick-config.ts";
import { buildRuntimeFor, mirrorDirOf, targetUrlOf } from "./runtime-wiring.ts";
import { createTicker, type Clock, type Ticker } from "./tick.ts";

type Repo = { owner: string; repo: string };

export interface ComposeOptions {
  root: string;
  dbPath: string;
  projectId: string;
  env: Record<string, string | undefined>;
  worktrees: WorktreeManager;
  runtime: AgentRuntime;
  prOf: (issueId: number) => number | null;
  clock: Clock;
  lock?: ProcessLockDeps;
  now?: () => Date;
  log?: (message: string) => void;
  createGitHub?: (token: string, repo: Repo) => GitHubPort;
  /** Home directory used when FRIDAY_HOME is not set; defaults to os.homedir(). */
  homeDir?: string;
  createRuntime?: (deps: ClaudeAgentSdkRuntimeDeps) => AgentRuntime;
  createGitHost?: (options: GitCliHostOptions) => GitHost;
  /** Role request builders; empty in production until the roles are wired. */
  roles?: StateDispatcherDeps["roles"];
  /** Triage limits; without it Todo issues are left alone. */
  triage?: TriageFicha;
}

export interface Daemon {
  ticker: Ticker;
  db: FridayDatabase;
  report: ReconcileReport;
  /** Releases the process lock and closes the database. */
  release(): void;
}

/** Reads the author token by variable name only (D56); fails closed. */
function readAuthor(opts: ComposeOptions): {
  token: string;
  tokenEnv: string;
  repo: Repo;
  repository: { owner: string; name: string };
} {
  const loaded = loadFactoryConfig(opts.root);
  if (!loaded.ok) throw new Error("O factory.yaml está inválido ou ausente.");
  const name = loaded.config.pull_requests.author_token_env;
  if (name === undefined)
    throw new Error("A configuração não define pull_requests.author_token_env.");
  const token = opts.env[name];
  if (token === undefined || token.trim() === "")
    throw new Error(`A variável ${name} está vazia ou ausente.`);
  const { owner, name: repo } = loaded.config.repository;
  return { token, tokenEnv: name, repo: { owner, repo }, repository: { owner, name: repo } };
}

const defaultGitHub = (token: string, repo: Repo): GitHubPort =>
  new GitHubRestAdapter(createGitHubClient(token), repo);

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

async function assemble(
  opts: ComposeOptions,
  db: FridayDatabase,
  github: GitHubPort,
  runtimeFor: NonNullable<RunRecordingDeps["runtimeFor"]>,
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
  const recording = {
    runs,
    recorder: createRunRecorder({ ...recorderDeps, ledger }),
    runtimeFor,
  };
  const budget = { ledger, recorderDeps };
  const report = await reconcile({ projectId, root, runs, issues, events, worktrees, now });
  const dispatcher = createStateDispatcher({
    projectId,
    github,
    issues,
    events,
    roles: opts.roles ?? {},
    readConfig: () => readDispatchConfig(root),
    prOf: opts.prOf,
    now,
    ...(opts.log === undefined ? {} : { log: opts.log }),
    ...(opts.triage === undefined
      ? {}
      : {
          triage: createTriageBranch({
            projectId,
            root,
            ficha: opts.triage,
            github,
            runtime: opts.runtime,
            recorder: recorderDeps,
            recording,
            budget,
            now,
            ...(opts.log === undefined ? {} : { log: opts.log }),
          }),
        }),
    verify: createVerifyBranch({
      projectId,
      recorder: recorderDeps,
      root,
      env: opts.env,
      ...(opts.log === undefined ? {} : { log: opts.log }),
    }),
  });
  const intake = createIntake({
    projectId,
    github,
    issues,
    events,
    now,
    ...(opts.log === undefined ? {} : { log: opts.log }),
  });
  const ticker = createTicker({
    projectId,
    clock: opts.clock,
    readConfig: () => readTickConfig(root),
    issues: {
      listReady: async (capacity) => {
        await intake.ingest().catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error);
          opts.log?.(`Failed to ingest issues: ${detail}`);
        });
        return dispatcher.listReady(capacity);
      },
      busy: () => dispatcher.busy(),
    },
    buildRequest: (id, runId) => dispatcher.buildRequest(id, runId),
    runtime: opts.runtime,
    events,
    ...(opts.log === undefined ? {} : { log: opts.log }),
    recording,
    budget,
    breaker: { breaker, recorderDeps },
  });
  return { ticker, report };
}

/** Process composition at startup: lock, database, reconcile, GitHub, intake and ticker. */
export async function composeDaemon(opts: ComposeOptions): Promise<Daemon> {
  const { token, tokenEnv, repo, repository } = readAuthor(opts);
  if (opts.triage !== undefined) assertTriageFicha(opts.triage);
  const gitHost = (opts.createGitHost ?? ((o) => new GitCliHost(o)))({
    tokenEnv,
    mirrorDir: mirrorDirOf({ env: opts.env, homeDir: opts.homeDir ?? homedir(), repository }),
    targetUrl: targetUrlOf(repository),
    env: opts.env,
  });
  const lock = acquireProcessLock(opts.root, opts.lock);
  let db: FridayDatabase | undefined;
  try {
    db = openDatabase(opts.dbPath);
    const github = (opts.createGitHub ?? defaultGitHub)(token, repo);
    const runtimeFor = buildRuntimeFor({
      db,
      github,
      gitHost,
      env: opts.env,
      ...(opts.createRuntime === undefined ? {} : { createRuntime: opts.createRuntime }),
    });
    const { ticker, report } = await assemble(opts, db, github, runtimeFor);
    const opened = db;
    return {
      ticker,
      db: opened,
      report,
      release() {
        lock.release();
        opened.close();
      },
    };
  } catch (error) {
    db?.close();
    lock.release();
    throw error;
  }
}
