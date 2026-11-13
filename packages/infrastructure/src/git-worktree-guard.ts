import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execa } from "execa";
import {
  assertLinkedWorktree,
  configEnv,
  GUARD_CONFIG_ARGS,
  guardsOf,
  HOOKS_OFF,
} from "./git-cli-commit.ts";
import { ALLOWED_KEYS } from "./git-cli-host.ts";

/** Allow-listed environment for a git child process (never the full daemon environment). */
export function baseEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && ALLOWED_KEYS.has(key.toUpperCase())) out[key] = value;
  }
  out.GIT_TERMINAL_PROMPT = "0";
  return out;
}

/** Runs git with exactly `env`; throws an `Error` with the first stderr line on a code outside `okCodes`. */
export async function run(
  args: string[],
  cwd: string,
  env: Record<string, string>,
  okCodes = [0],
): Promise<string> {
  const result = await execa("git", args, { cwd, env, extendEnv: false, reject: false });
  if (!okCodes.includes(result.exitCode ?? -1)) {
    throw new Error(String(result.stderr ?? "").split("\n")[0]);
  }
  return String(result.stdout ?? "");
}

/** The worktree must be a linked worktree of `repoDir`; returns its real gitdir. */
export async function assertOwnedWorktree(repoDir: string, path: string): Promise<string> {
  const gitDir = await assertLinkedWorktree(path);
  const common = await realpath(join(repoDir, ".git")).catch(() => "");
  if (common === "" || dirname(dirname(gitDir)) !== common) {
    throw new Error("o worktree não pertence ao repositório do daemon.");
  }
  return gitDir;
}

/** Config pairs of the daemon-side commands: no hooks, no fsmonitor, no filter drivers, no config-defined hooks. */
export function pairsOf(drivers: string[], hooks: string[]): [string, string][] {
  const pairs: [string, string][] = [
    ["core.hooksPath", HOOKS_OFF],
    ["core.fsmonitor", "false"],
  ];
  for (const d of drivers) {
    pairs.push(
      [`filter.${d}.clean`, ""],
      [`filter.${d}.smudge`, ""],
      [`filter.${d}.process`, ""],
      [`filter.${d}.required`, "false"],
    );
  }
  for (const h of hooks) pairs.push([`hook.${h}.enabled`, "false"]);
  return pairs;
}

/** Environment of the daemon-side git commands: allow-listed, no hooks, no fsmonitor, no filter drivers or hooks of `repoDir`. */
export async function protectedEnv(repoDir: string): Promise<Record<string, string>> {
  const first = { ...baseEnv(), ...configEnv(pairsOf([], [])) };
  const found = guardsOf(await run(GUARD_CONFIG_ARGS, repoDir, first, [0, 1]));
  return { ...baseEnv(), ...configEnv(pairsOf(found.drivers, found.hooks)) };
}
