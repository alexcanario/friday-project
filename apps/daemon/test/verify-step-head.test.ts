import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitHead, runVerifyStep } from "../src/index.ts";

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

const FIXTURE = join(import.meta.dirname, "../../../packages/infrastructure/test/fixtures/valid");
const SHA = "a".repeat(40);

function registryWith(command: string): string {
  const root = mkdtempSync(join(tmpdir(), "friday-head-reg-"));
  cpSync(FIXTURE, root, { recursive: true });
  const file = join(root, "factory.yaml");
  const yaml = readFileSync(file, "utf8").replace(
    /verify:\r?\n {2}command: .*\r?\n {2}timeout_s: .*\r?\n/,
    `verify:\n  command: ${JSON.stringify(command)}\n  timeout_s: 60\n`,
  );
  writeFileSync(file, yaml);
  return root;
}

describe("runVerifyStep readHead failure", { timeout: 30_000 }, () => {
  it("runVerifyStep holds with RuntimeFailed when readHead rejects", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "friday-head-wt-"));
    const command = `node -e "require('node:fs').writeFileSync('ran.txt','x')"`;
    const env = { PATH: process.env.PATH, HOME: process.env.HOME };
    const outcome = await runVerifyStep(
      {
        registryRoot: registryWith(command),
        repoDir: "unused",
        env,
        readHead: async () => {
          throw new Error("gitdir de outro repositório");
        },
      },
      { worktreePath: worktree, headSha: SHA },
    );
    expect(outcome).toEqual({
      input: { type: "RunHeld", reason: "RuntimeFailed" },
      detail: "gitdir de outro repositório",
    });
    expect(existsSync(join(worktree, "ran.txt"))).toBe(false);

    const passed = await runVerifyStep(
      { registryRoot: registryWith(command), repoDir: "unused", env, readHead: async () => SHA },
      { worktreePath: worktree, headSha: SHA },
    );
    expect(passed.input).toEqual({ type: "VerifyPassed" });
  });
});
