import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stepEnv } from "./git-cli-commit.ts";
import { assertOwnedWorktree, baseEnv, run } from "./git-worktree-guard.ts";

/**
 * HEAD of an agent-owned worktree. The `.git` of the worktree must be a linked worktree of `repoDir`
 * (a redirected gitdir is rejected), and `git rev-parse HEAD` runs with an explicit gitdir and the
 * allow-listed environment, so neither the daemon environment nor the agent config can forge the sha.
 */
export async function readWorktreeHead(repoDir: string, path: string): Promise<string> {
  const gitDir = await assertOwnedWorktree(repoDir, path);
  const home = await mkdtemp(join(tmpdir(), "friday-git-home-"));
  try {
    const env = stepEnv({ baseEnv: baseEnv(), worktree: path }, gitDir, home, []);
    return (await run(["rev-parse", "HEAD"], path, env)).trim();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
