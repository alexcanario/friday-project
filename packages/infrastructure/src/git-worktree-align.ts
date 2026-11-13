import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execa } from "execa";
import {
  assertLinkedWorktree,
  configEnv,
  filterDrivers,
  HOOKS_OFF,
  stepEnv,
} from "./git-cli-commit.ts";
import { ALLOWED_KEYS } from "./git-cli-host.ts";

const FULL_SHA = /^[0-9a-f]{40}$/;

export const isFullSha = (sha: string): boolean => FULL_SHA.test(sha);

function baseEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && ALLOWED_KEYS.has(key.toUpperCase())) out[key] = value;
  }
  out.GIT_TERMINAL_PROMPT = "0";
  return out;
}

async function run(
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

/**
 * Moves the agent-owned worktree to `sha`. The `.git` of the worktree must be a linked worktree of
 * `repoDir`; the fetch runs in `repoDir` (objects are shared) and every step on the worktree runs with
 * an explicit gitdir, no hooks, no fsmonitor and no filter drivers.
 */
export async function alignWorktree(repoDir: string, path: string, sha: string): Promise<void> {
  const gitDir = await assertLinkedWorktree(path);
  const common = await realpath(join(repoDir, ".git")).catch(() => "");
  if (common === "" || dirname(dirname(gitDir)) !== common) {
    throw new Error("o worktree não pertence ao repositório do daemon.");
  }
  const base = baseEnv();
  await run(["fetch", "origin", sha], repoDir, {
    ...base,
    ...configEnv([["core.hooksPath", HOOKS_OFF]]),
  });
  const home = await mkdtemp(join(tmpdir(), "friday-git-home-"));
  try {
    const request = { baseEnv: base, worktree: path };
    const filters = await run(
      ["config", "--get-regexp", "^filter\\."],
      path,
      stepEnv(request, gitDir, home, []),
      [0, 1],
    );
    const env = stepEnv(request, gitDir, home, filterDrivers(filters));
    const status = await run(["status", "--porcelain", "--untracked-files=all"], path, env);
    if (status.trim() !== "") throw new Error("a worktree tem alterações.");
    await run(["checkout", "--detach", sha], path, env);
    if ((await run(["rev-parse", "HEAD"], path, env)).trim() !== sha) {
      throw new Error("o HEAD da worktree não ficou no sha pedido.");
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
