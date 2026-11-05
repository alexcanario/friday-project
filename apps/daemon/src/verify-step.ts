import { spawn, execFile } from "node:child_process";
import type { WorkflowInput } from "@friday/domain";
import { buildRunEnv, loadFactoryConfig } from "@friday/infrastructure";

const TAIL_CHARS = 4000;
const EXIT_GRACE_MS = 200;

export interface VerifyStepDeps {
  registryRoot: string;
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
  | { input: { type: "RunHeld"; reason: "RunMisconfigured" } };

/** Reads the current commit of a worktree. */
export function gitHead(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.replace(/\r?\n$/, ""));
    });
  });
}

function verifyEnv(source: Record<string, string | undefined>): Record<string, string> {
  const env = buildRunEnv(source);
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "anthropic_api_key") delete env[key];
  }
  return env;
}

type RunEnd = { kind: "exit"; code: number | null; tail: string } | { kind: "timeout" };

function runCommand(
  command: string,
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<RunEnd> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, detached: true, cwd, env });
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
    const timer = setTimeout(() => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // group already gone
        }
      }
      finish({ kind: "timeout" });
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
      setTimeout(() => finish({ kind: "exit", code, tail }), EXIT_GRACE_MS);
    });
    child.on("close", (code) => finish({ kind: "exit", code, tail }));
  });
}

/** Runs the registry verify.command in the worktree and returns the state machine input. */
export async function runVerifyStep(
  deps: VerifyStepDeps,
  input: VerifyStepInput,
): Promise<VerifyStepOutcome> {
  const loaded = loadFactoryConfig(deps.registryRoot);
  if (!loaded.ok) return { input: { type: "RunHeld", reason: "RunMisconfigured" } };
  const head = await (deps.readHead ?? gitHead)(input.worktreePath);
  if (head !== input.headSha) return { input: { type: "VerifyHeadChanged" } };
  const { command, timeout_s: timeoutS } = loaded.config.verify;
  const end = await runCommand(command, input.worktreePath, verifyEnv(deps.env), timeoutS * 1000);
  if (end.kind === "timeout") return { input: { type: "VerifyTimedOut" } };
  if (end.code === 0) return { input: { type: "VerifyPassed" } };
  return { input: { type: "VerifyFailed" }, feedback: end.tail };
}
