import { isAbsolute, join } from "node:path";
import { toAgentRunOptions, type AgentRunOptions, type WorktreeManager } from "@friday/application";
import {
  composeDaemon,
  createRedactor,
  type Clock,
  type Daemon,
  type SpecialistCompose,
} from "@friday/daemon";
import {
  GitWorktreeManager,
  loadFactoryConfig,
  loadTriageAgent,
  type GitWorktreeManagerDeps,
} from "@friday/infrastructure";
import { qaComposeOf } from "./daemon-qa.ts";
import { daemonPaths, judgeInputOf, projectIdOf } from "./daemon-values.ts";

type Result = { stdout: string; stderr: string; code: number };

export type DaemonDeps = {
  env: Record<string, string | undefined>;
  homeDir: string;
  compose?: typeof composeDaemon;
  createWorktrees?: (deps: GitWorktreeManagerDeps) => WorktreeManager;
  clock?: Clock;
  onSignal?: (handler: () => void) => void;
  exit?: (code: number) => void;
  log?: (message: string) => void;
};

const USAGE = "Uso: friday daemon\n";

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

/** Reads the judge and judge-strong cards of the central registry; null when one is missing. */
function judgeAgentsOf(
  loaded: Extract<ReturnType<typeof loadFactoryConfig>, { ok: true }>,
): Record<"judge" | "judge-strong", AgentRunOptions> | null {
  const judge = loaded.agents["judge"];
  const strong = loaded.agents["judge-strong"];
  if (judge === undefined || strong === undefined) return null;
  return { judge: toAgentRunOptions(judge), "judge-strong": toAgentRunOptions(strong) };
}

/** Reads the backend card of the central registry as the specialist option; null when missing. */
export function specialistComposeOf(
  loaded: Extract<ReturnType<typeof loadFactoryConfig>, { ok: true }>,
): SpecialistCompose | null {
  const card = loaded.agents["backend"];
  return card === undefined ? null : { agent: toAgentRunOptions(card) };
}

/** Names of the token variables configured in pull_requests; empty when the config is not loaded. */
function tokenEnvNamesOf(loaded: ReturnType<typeof loadFactoryConfig>): string[] {
  if (!loaded.ok) return [];
  const { author_token_env: author, review_token_env: review } = loaded.config.pull_requests;
  return [author, review].filter((name): name is string => name !== undefined);
}

/** The injected log writer, or stderr by default. */
function logOf(deps: DaemonDeps): (message: string) => void {
  return deps.log ?? ((message: string) => void process.stderr.write(`${message}\n`));
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

/** Waits for the stop signal, then stops the ticker, drains it and releases the daemon. A second signal forces exit 130. */
function untilSignal(
  daemon: Daemon,
  stop: () => void,
  onSignal: (handler: () => void) => void,
  exit: (code: number) => void,
  redact: (text: string) => string,
): Promise<Result> {
  return new Promise<Result>((resolve) => {
    let signals = 0;
    let forced = false;
    onSignal(() => {
      signals += 1;
      if (signals === 2) {
        forced = true;
        resolve({ stdout: "", stderr: "", code: 130 });
        exit(130);
        return;
      }
      if (signals > 2) return;
      stop();
      void daemon.ticker
        .idle()
        .then(() => {
          if (forced) return;
          daemon.release();
          resolve({ stdout: "", stderr: "", code: 0 });
        })
        .catch((error: unknown) => {
          if (forced) return;
          daemon.release();
          resolve(fail(`${redact(error instanceof Error ? error.message : String(error))}\n`));
        });
    });
  });
}

export async function startDaemon(deps: DaemonDeps): Promise<Result> {
  if (rootRefusal(deps.env)) return fail("A variável FRIDAY_HOME deve ser um caminho absoluto.\n");
  const { env, homeDir } = deps;
  const root = daemonPaths({ env, homeDir, repository: { owner: "", name: "" } }).root;
  const loaded = loadFactoryConfig(root);
  if (!loaded.ok) return fail("O factory.yaml está inválido ou ausente.\n");
  const repository = loaded.config.repository;
  const judgeAgents = judgeAgentsOf(loaded);
  if (judgeAgents === null)
    return fail("A ficha judge ou judge-strong não está no registro central.\n");
  const triage = loadTriageAgent(root);
  if (!triage.ok) return fail("A ficha triage não está no registro central.\n");
  const qa = qaComposeOf(loaded);
  if (qa === null) return fail("A ficha qa não está no registro central.\n");
  const specialist = specialistComposeOf(loaded);
  if (specialist === null) return fail("A ficha backend não está no registro central.\n");
  const paths = daemonPaths({ env, homeDir, repository });
  const redact = createRedactor(env, tokenEnvNamesOf(loaded));
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
      clock: deps.clock ?? realClock,
      triage: triage.agent,
      qa,
      specialist,
      log: logOf(deps),
      judge: {
        agents: judgeAgents,
        input: (issueId) => judgeInputOf({ root: paths.root, repository, issueId }),
      },
    });
    const stop = startOrRelease(daemon);
    const exit = deps.exit ?? ((code: number) => process.exit(code));
    return await untilSignal(daemon, stop, deps.onSignal ?? defaultOnSignal, exit, redact);
  } catch (error) {
    return fail(`${redact(error instanceof Error ? error.message : String(error))}\n`);
  }
}

export function runDaemonCommand(args: string[], deps: DaemonDeps): Promise<Result> {
  if (args.length !== 1) return Promise.resolve({ stdout: "", stderr: USAGE, code: 2 });
  return startDaemon(deps);
}
