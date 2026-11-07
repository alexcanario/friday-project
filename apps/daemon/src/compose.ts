import type { AgentRuntime, GitHubPort, WorktreeManager } from "@friday/application";
import {
  GitHubRestAdapter,
  createEventStore,
  createGitHubClient,
  createIssueRepository,
  createRunRepository,
  loadFactoryConfig,
  openDatabase,
  type FridayDatabase,
} from "@friday/infrastructure";
import { readDispatchConfig } from "./compose-config.ts";
import { createIntake } from "./intake.ts";
import { acquireProcessLock, type ProcessLockDeps } from "./process-lock.ts";
import { reconcile, type ReconcileReport } from "./reconcile.ts";
import { createRunRecorder } from "./run-recorder.ts";
import { createStateDispatcher } from "./state-dispatcher.ts";
import { readTickConfig } from "./tick-config.ts";
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
}

export interface Daemon {
  ticker: Ticker;
  db: FridayDatabase;
  report: ReconcileReport;
  /** Releases the process lock and closes the database. */
  release(): void;
}

/** Reads the author token by variable name only (D56); fails closed. */
function readAuthor(opts: ComposeOptions): { token: string; repo: Repo } {
  const loaded = loadFactoryConfig(opts.root);
  if (!loaded.ok) throw new Error("O factory.yaml está inválido ou ausente.");
  const name = loaded.config.pull_requests.author_token_env;
  if (name === undefined)
    throw new Error("A configuração não define pull_requests.author_token_env.");
  const token = opts.env[name];
  if (token === undefined || token.trim() === "")
    throw new Error(`A variável ${name} está vazia ou ausente.`);
  const { owner, name: repo } = loaded.config.repository;
  return { token, repo: { owner, repo } };
}

const defaultGitHub = (token: string, repo: Repo): GitHubPort =>
  new GitHubRestAdapter(createGitHubClient(token), repo);

async function assemble(opts: ComposeOptions, db: FridayDatabase, github: GitHubPort) {
  const { root, projectId, worktrees } = opts;
  const now = opts.now ?? (() => new Date());
  const issues = createIssueRepository(db);
  const events = createEventStore(db);
  const runs = createRunRepository(db);
  db.sqlite.prepare("INSERT OR IGNORE INTO projects (id) VALUES (?)").run(projectId);
  const report = await reconcile({ projectId, root, runs, issues, events, worktrees, now });
  const dispatcher = createStateDispatcher({
    projectId,
    github,
    issues,
    events,
    roles: {},
    readConfig: () => readDispatchConfig(root),
    prOf: opts.prOf,
    now,
    ...(opts.log === undefined ? {} : { log: opts.log }),
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
    recording: { runs, recorder: createRunRecorder({ projectId, events, issues, now }) },
  });
  return { ticker, report };
}

/** Process composition at startup: lock, database, reconcile, GitHub, intake and ticker. */
export async function composeDaemon(opts: ComposeOptions): Promise<Daemon> {
  const { token, repo } = readAuthor(opts);
  const lock = acquireProcessLock(opts.root, opts.lock);
  let db: FridayDatabase | undefined;
  try {
    db = openDatabase(opts.dbPath);
    const github = (opts.createGitHub ?? defaultGitHub)(token, repo);
    const { ticker, report } = await assemble(opts, db, github);
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
