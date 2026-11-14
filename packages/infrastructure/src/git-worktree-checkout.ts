import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GUARD_CONFIG_ARGS, guardsOf, stepEnv } from "./git-cli-commit.ts";
import { assertOwnedWorktree, baseEnv, protectedEnv, run } from "./git-worktree-guard.ts";

/**
 * Adds the worktree at `path` (`args` are the branch arguments of `git worktree add`) without checking
 * it out, then populates it in the context of the new worktree. A filter driver or a config hook can
 * come from an `includeIf` (`onbranch:` or `gitdir:`) that only matches the new gitdir and branch, so
 * the protections are read there, with the branch already active, and the checkout runs with them.
 * When a step after the add fails, the folder and its registry in `.git/worktrees` are removed.
 */
export async function addWorktreeChecked(
  repoDir: string,
  path: string,
  args: string[],
): Promise<void> {
  const env = await protectedEnv(repoDir);
  await run(["worktree", "add", "--no-checkout", path, ...args], repoDir, env);
  let home: string | undefined;
  try {
    const gitDir = await assertOwnedWorktree(repoDir, path);
    home = await mkdtemp(join(tmpdir(), "friday-git-home-"));
    const request = { baseEnv: baseEnv(), worktree: path };
    const found = await run(GUARD_CONFIG_ARGS, path, stepEnv(request, gitDir, home, []), [0, 1]);
    const guards = guardsOf(found);
    await run(
      ["checkout", "--force", "HEAD"],
      path,
      stepEnv(request, gitDir, home, guards.drivers, guards.hooks),
    );
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    await run(["worktree", "prune"], repoDir, env).catch(() => undefined);
    throw error;
  } finally {
    if (home !== undefined) await rm(home, { recursive: true, force: true });
  }
}
