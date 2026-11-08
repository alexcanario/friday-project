import { isAbsolute, join } from "node:path";
import type { AgentRuntime, WorktreeManager } from "@friday/application";
import { composeDaemon, type Clock, type Daemon } from "@friday/daemon";
import {
  GitWorktreeManager,
  loadFactoryConfig,
  type GitWorktreeManagerDeps,
} from "@friday/infrastructure";
import { daemonPaths, projectIdOf } from "./daemon-values.ts";

type Result = { stdout: string; stderr: string; code: number };

export type DaemonDeps = {
  env: Record<string, string | undefined>;
  homeDir: string;
  compose?: typeof composeDaemon;
  createWorktrees?: (deps: GitWorktreeManagerDeps) => WorktreeManager;
  clock?: Clock;
  onSignal?: (handler: () => void) => void;
};

const USAGE = "Uso: friday daemon\n";

/** Provisional until #246 delivers createPrOf. */
const prOf = (): number | null => null;

/** Provisional until #248 makes ComposeOptions.runtime optional; unreachable in practice. */
const unwiredRuntime: AgentRuntime = {
  run: () => Promise.reject(new Error("O runtime do ticker não está ligado.")),
};

const realClock: Clock = {
  now: Date.now,
  every: (ms, fn) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
};

function defaultOnSignal(handler: () => void): void {
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}

const fail = (stderr: string): Result => ({ stdout: "", stderr, code: 1 });

function rootRefusal(env: DaemonDeps["env"]): boolean {
  const home = env.FRIDAY_HOME;
  if (home === undefined || home === "") return false;
  return home !== home.trim() || !isAbsolute(home);
}

/** Starts the ticker; if it throws, releases the lock and database before rethrowing. */
function startOrRelease(daemon: Daemon): () => void {
  try {
    return daemon.ticker.start();
  } catch (error) {
    daemon.release();
    throw error;
  }
}

/** Waits for the stop signal, then stops the ticker, drains it and releases the daemon. */
function untilSignal(
  daemon: Daemon,
  stop: () => void,
  onSignal: (handler: () => void) => void,
): Promise<Result> {
  return new Promise<Result>((resolve) => {
    let done = false;
    onSignal(() => {
      if (done) return;
      done = true;
      stop();
      void daemon.ticker
        .idle()
        .then(() => {
          daemon.release();
          resolve({ stdout: "", stderr: "", code: 0 });
        })
        .catch((error: unknown) => {
          daemon.release();
          resolve(fail(`${error instanceof Error ? error.message : String(error)}\n`));
        });
    });
  });
}

export async function startDaemon(deps: DaemonDeps): Promise<Result> {
  if (rootRefusal(deps.env)) return fail("A variável FRIDAY_HOME deve ser um caminho absoluto.\n");
  const { env, homeDir } = deps;
  const root = daemonPaths({
    env,
    homeDir,
    repository: { owner: "", name: "" },
  }).root;
  const loaded = loadFactoryConfig(root);
  if (!loaded.ok) return fail("O factory.yaml está inválido ou ausente.\n");
  const repository = loaded.config.repository;
  const paths = daemonPaths({ env, homeDir, repository });
  try {
    const createWorktrees =
      deps.createWorktrees ?? ((d: GitWorktreeManagerDeps) => new GitWorktreeManager(d));
    const worktrees = createWorktrees({ repoDir: paths.repoDir });
    const daemon = await (deps.compose ?? composeDaemon)({
      root: paths.root,
      worktreesRoot: join(paths.root, "worktrees"),
      dbPath: paths.dbPath,
      projectId: projectIdOf(repository),
      env,
      homeDir,
      worktrees,
      prOf,
      clock: deps.clock ?? realClock,
      runtime: unwiredRuntime,
    });
    const stop = startOrRelease(daemon);
    return await untilSignal(daemon, stop, deps.onSignal ?? defaultOnSignal);
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : String(error)}\n`);
  }
}

export function runDaemonCommand(args: string[], deps: DaemonDeps): Promise<Result> {
  if (args.length !== 1) return Promise.resolve({ stdout: "", stderr: USAGE, code: 2 });
  return startDaemon(deps);
}
