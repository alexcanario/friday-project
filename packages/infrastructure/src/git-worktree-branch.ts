import { protectedEnv, run } from "./git-worktree-guard.ts";

const CHECKOUT_CONFIG = [
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.safecrlf=false",
  "-c",
  "core.eol=lf",
];

/**
 * Re-creates the worktree at `path` on the local `branch` when that branch already exists (a worktree
 * folder deleted by hand, or removed on restart): no `-b`, no `origin/<base>`, the branch commits stay.
 * Returns false, running nothing else, when the branch does not exist (`rev-parse` exits 1).
 * The checkout writes a tree the agent authored, so every command runs in `repoDir` with the
 * protected environment of `protectedEnv`.
 */
export async function addExistingBranch(
  repoDir: string,
  path: string,
  branch: string,
): Promise<boolean> {
  const env = await protectedEnv(repoDir);
  const found = await run(
    ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
    repoDir,
    env,
    [0, 1],
  );
  if (found.trim() === "") return false;
  // Clears the registry of a folder deleted by hand; without it `worktree add` exits 128.
  await run(["worktree", "prune"], repoDir, env);
  await run([...CHECKOUT_CONFIG, "worktree", "add", path, branch], repoDir, env);
  return true;
}
