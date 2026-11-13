import { configEnv, filterDrivers, HOOKS_OFF } from "./git-cli-commit.ts";
import { baseEnv, run } from "./git-worktree-guard.ts";

const CHECKOUT_CONFIG = [
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.safecrlf=false",
  "-c",
  "core.eol=lf",
];

/** Config pairs shared by the commands below: no hooks, no fsmonitor, plus no filter drivers. */
function pairsOf(drivers: string[]): [string, string][] {
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
  return pairs;
}

/** Environment of the daemon-side git commands: allow-listed, no hooks, no fsmonitor, no filter drivers of `repoDir`. */
async function protectedEnv(repoDir: string): Promise<Record<string, string>> {
  const first = { ...baseEnv(), ...configEnv(pairsOf([])) };
  const filters = await run(["config", "--get-regexp", "^filter\\."], repoDir, first, [0, 1]);
  return { ...baseEnv(), ...configEnv(pairsOf(filterDrivers(filters))) };
}

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
