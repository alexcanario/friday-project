import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configEnv, filterDrivers, HOOKS_OFF, stepEnv } from "./git-cli-commit.ts";
import { assertOwnedWorktree, baseEnv, run } from "./git-worktree-guard.ts";

const FULL_SHA = /^[0-9a-f]{40}$/;

export const isFullSha = (sha: string): boolean => FULL_SHA.test(sha);

/**
 * Moves the agent-owned worktree to `sha`. The `.git` of the worktree must be a linked worktree of
 * `repoDir`; the fetch runs in `repoDir` (objects are shared) and every step on the worktree runs with
 * an explicit gitdir, no hooks, no fsmonitor and no filter drivers.
 */
export async function alignWorktree(repoDir: string, path: string, sha: string): Promise<void> {
  const gitDir = await assertOwnedWorktree(repoDir, path);
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
