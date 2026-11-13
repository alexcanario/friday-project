import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GUARD_CONFIG_ARGS, guardsOf, stepEnv } from "./git-cli-commit.ts";
import { assertOwnedWorktree, baseEnv, protectedEnv, run } from "./git-worktree-guard.ts";

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
  await run(["fetch", "origin", sha], repoDir, await protectedEnv(repoDir));
  const home = await mkdtemp(join(tmpdir(), "friday-git-home-"));
  try {
    const request = { baseEnv: base, worktree: path };
    const found = await run(GUARD_CONFIG_ARGS, path, stepEnv(request, gitDir, home, []), [0, 1]);
    const guards = guardsOf(found);
    const env = stepEnv(request, gitDir, home, guards.drivers, guards.hooks);
    const status = await run(
      ["status", "--porcelain", "--untracked-files=all", "--ignore-submodules=all"],
      path,
      env,
    );
    if (status.trim() !== "") throw new Error("a worktree tem alterações.");
    await run(["checkout", "--detach", sha], path, env);
    if ((await run(["rev-parse", "HEAD"], path, env)).trim() !== sha) {
      throw new Error("o HEAD da worktree não ficou no sha pedido.");
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
