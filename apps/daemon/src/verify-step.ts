import { spawn, execFile } from "node:child_process";
import type { WorkflowInput } from "@friday/domain";
import { buildRunEnv, loadFactoryConfig, readWorktreeHead } from "@friday/infrastructure";

const TAIL_CHARS = 4000;
const EXIT_GRACE_MS = 200;

export interface VerifyStepDeps {
  registryRoot: string;
  /** Repository of the daemon: the worktree read by `gitHead` must be a linked worktree of it. */
  repoDir: string;
  env: Record<string, string | undefined>;
  readHead?: (cwd: string) => Promise<string>;
}

export interface VerifyStepInput {
  worktreePath: string;
  headSha: string;
}

export type VerifyStepOutcome =
  | { input: Extract<WorkflowInput, { type: "VerifyPassed" }> }
  | { input: Extract<WorkflowInput, { type: "VerifyFailed" }>; feedback: string }
  | { input: Extract<WorkflowInput, { type: "VerifyTimedOut" }> }
  | { input: Extract<WorkflowInput, { type: "VerifyHeadChanged" }> }
  | {
      input: { type: "RunHeld"; reason: "RunMisconfigured" | "RuntimeFailed" };
      detail?: string;
    };

/** Reads the current commit of a linked worktree of `repoDir` (rejects any other gitdir). */
export function gitHead(cwd: string, repoDir: string): Promise<string> {
  return readWorktreeHead(repoDir, cwd);
}

function verifyEnv(source: Record<string, string | undefined>): Record<string, string> {
  const env = buildRunEnv(source);
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "anthropic_api_key") delete env[key];
  }
  return env;
}

type RunEnd = { kind: "exit"; code: number | null; tail: string } | { kind: "timeout" };

const IS_WINDOWS = process.platform === "win32";

/**
 * Kills the command and its descendants, then calls `done`. On Windows there are no
 * process groups (`process.kill(-pid)` throws), so `taskkill /T /F` kills the tree.
 */
function killTree(pid: number | undefined, done: () => void): void {
  if (pid === undefined) return done();
  if (IS_WINDOWS) {
    execFile("taskkill", ["/T", "/F", "/PID", String(pid)], () => done());
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // group already gone
  }
  done();
}

function runCommand(
  command: string,
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<RunEnd> {
  return new Promise((resolve, reject) => {
    // On Windows `detached` gives the command its own console and its output is lost;
    // the tree is killed by pid there, so a process group is only needed elsewhere.
    const child = spawn(command, { shell: true, detached: !IS_WINDOWS, cwd, env });
    let tail = "";
    let settled = false;
    const collect = (chunk: string): void => {
      tail = (tail + chunk).slice(-TAIL_CHARS);
    };
    child.stdout.setEncoding("utf8").on("data", collect);
    child.stderr.setEncoding("utf8").on("data", collect);
    const releasePipes = (): void => {
      child.stdout.destroy();
      child.stderr.destroy();
    };
    let timedOut = false;
    const ended = (code: number | null): RunEnd =>
      timedOut ? { kind: "timeout" } : { kind: "exit", code, tail };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid, () => finish({ kind: "timeout" }));
    }, timeoutMs);
    const finish = (end: RunEnd | Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      releasePipes();
      if (end instanceof Error) reject(end);
      else resolve(end);
    };
    child.on("error", (error) => finish(error));
    // A detached grandchild may keep the pipes open after the command exits, so
    // `close` is not guaranteed: give the streams a short grace period, then settle.
    child.on("exit", (code) => {
      setTimeout(() => finish(ended(code)), EXIT_GRACE_MS);
    });
    child.on("close", (code) => finish(ended(code)));
  });
}

/** Runs the registry verify.command in the worktree and returns the state machine input. */
export async function runVerifyStep(
  deps: VerifyStepDeps,
  input: VerifyStepInput,
): Promise<VerifyStepOutcome> {
  const loaded = loadFactoryConfig(deps.registryRoot);
  if (!loaded.ok) return { input: { type: "RunHeld", reason: "RunMisconfigured" } };
  const readHead = deps.readHead ?? ((cwd) => gitHead(cwd, deps.repoDir));
  let head: string;
  try {
    head = await readHead(input.worktreePath);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return {
      input: { type: "RunHeld", reason: "RuntimeFailed" },
      detail: text.split("\n")[0] ?? "",
    };
  }
  if (head !== input.headSha) return { input: { type: "VerifyHeadChanged" } };
  const { command, timeout_s: timeoutS } = loaded.config.verify;
  const end = await runCommand(command, input.worktreePath, verifyEnv(deps.env), timeoutS * 1000);
  if (end.kind === "timeout") return { input: { type: "VerifyTimedOut" } };
  if (end.code === 0) return { input: { type: "VerifyPassed" } };
  return { input: { type: "VerifyFailed" }, feedback: end.tail };
}
