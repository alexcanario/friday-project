import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitHead } from "../src/index.ts";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();

interface Repo {
  dir: string;
  worktree: string;
}

/** A repository with one commit and a linked worktree under `<base>/wt/1`. */
function repoWithWorktree(message: string): Repo {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), "friday-head-")));
  const dir = join(base, "repo");
  mkdirSync(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "commit", "-q", "--allow-empty", "-m", message);
  const worktree = join(base, "wt", "1");
  git(dir, "worktree", "add", "-q", "-b", "friday/1", worktree);
  return { dir, worktree };
}

describe("gitHead (protected)", { timeout: 30_000 }, () => {
  it("gitHead rejects a worktree whose gitdir belongs to another repository", async () => {
    const mine = repoWithWorktree("mine");
    const other = repoWithWorktree("other");
    const otherGitDir = join(other.dir, ".git", "worktrees", "1");
    rmSync(join(mine.worktree, ".git"));
    writeFileSync(join(mine.worktree, ".git"), `gitdir: ${otherGitDir}\n`);
    await expect(gitHead(mine.worktree, mine.dir)).rejects.toBeInstanceOf(Error);
  });

  it("gitHead reads the real HEAD of a legitimate linked worktree", async () => {
    const repo = repoWithWorktree("one");
    const first = await gitHead(repo.worktree, repo.dir);
    expect(first).toBe(git(repo.worktree, "rev-parse", "HEAD"));
    expect(first).toMatch(/^[0-9a-f]{40}$/);
    git(repo.worktree, "commit", "-q", "--allow-empty", "-m", "two");
    const second = await gitHead(repo.worktree, repo.dir);
    expect(second).not.toBe(first);
    expect(second).toBe(git(repo.worktree, "rev-parse", "HEAD"));
  });

  it("gitHead ignores GIT_DIR of the daemon environment", async () => {
    const mine = repoWithWorktree("mine");
    const other = repoWithWorktree("other");
    const expected = git(mine.worktree, "rev-parse", "HEAD");
    expect(git(other.dir, "rev-parse", "HEAD")).not.toBe(expected);
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = join(other.dir, ".git");
    try {
      expect(await gitHead(mine.worktree, mine.dir)).toBe(expected);
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
  });
});
