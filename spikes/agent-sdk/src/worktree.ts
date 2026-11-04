import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function createWorktree(repo: string, dir: string): Promise<void> {
  try {
    await run("git", ["-C", repo, "rev-parse", "--git-dir"]);
  } catch {
    throw new Error(`repositório git inválido: ${repo}`);
  }
  await run("git", ["-C", repo, "worktree", "add", "--detach", dir]);
}
