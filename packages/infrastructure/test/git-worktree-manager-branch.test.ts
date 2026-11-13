import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GitWorktreeManager } from "../src/git-worktree-manager.ts";
import { git, makeFixture, type Fixture } from "./worktree-helpers.ts";

let fx: Fixture;
let mgr: GitWorktreeManager;
const BRANCH = "friday/17-existente";
const req = (issue = 17, title = "Existente", base = "develop") => ({
  root: fx.root,
  project: fx.project,
  issue,
  title,
  base,
});
const worktreePath = (issue = 17) => join(fx.root, fx.project, String(issue));
const posix = (p: string) => p.replace(/\\/g, "/");

/** Installs a `post-checkout` hook that creates `marker` when it runs. */
function installHook(hooksDir: string, marker: string): void {
  mkdirSync(hooksDir, { recursive: true });
  const hook = join(hooksDir, "post-checkout");
  writeFileSync(hook, `#!/bin/sh\ntouch "${posix(marker)}"\n`);
  chmodSync(hook, 0o755);
}

beforeEach(() => {
  fx = makeFixture();
  mgr = new GitWorktreeManager({ repoDir: fx.repoDir });
  // The markers of the hook and filter tests live here, before `create` makes the folder.
  mkdirSync(fx.root, { recursive: true });
});

// Each test runs dozens of git commands; on the Windows runner one took 7 s.
describe("GitWorktreeManager.create with an existing branch", { timeout: 30_000 }, () => {
  it("create reuses an existing branch when the worktree folder is gone", async () => {
    const first = await mgr.create(req());
    if (!first.ok) throw new Error(first.error.message);
    writeFileSync(join(first.value.path, "work.txt"), "trabalho\n");
    git(first.value.path, "add", ".");
    git(first.value.path, "commit", "-m", "work");
    const branchHead = git(first.value.path, "rev-parse", "HEAD");
    // Deleted by hand, without `git worktree remove`: the registry still lists it.
    rmSync(first.value.path, { recursive: true, force: true });
    expect(existsSync(first.value.path)).toBe(false);

    const again = await mgr.create(req());
    expect(again).toEqual({ ok: true, value: { path: worktreePath() } });
    expect(git(worktreePath(), "rev-parse", "--abbrev-ref", "HEAD")).toBe(BRANCH);
    expect(git(worktreePath(), "rev-parse", "HEAD")).toBe(branchHead);
    expect(branchHead).not.toBe(git(fx.repoDir, "rev-parse", "origin/develop"));
  });

  it("create still branches from origin base when the branch does not exist", async () => {
    const created = await mgr.create(req());
    expect(created.ok).toBe(true);
    expect(git(worktreePath(), "rev-parse", "--abbrev-ref", "HEAD")).toBe(BRANCH);
    expect(git(worktreePath(), "rev-parse", "HEAD")).toBe(
      git(fx.repoDir, "rev-parse", "origin/develop"),
    );
    const unsafe = await mgr.create(req(18, "Outra", "--bad"));
    expect(unsafe.ok).toBe(false);
    if (!unsafe.ok) expect(unsafe.error.code).toBe("WorktreeCreateFailed");
    expect(existsSync(worktreePath(18))).toBe(false);
  });

  it("create fails with WorktreeCreateFailed when the branch is checked out in another worktree", async () => {
    const first = await mgr.create(req());
    if (!first.ok) throw new Error(first.error.message);
    const elsewhere = join(fx.root, "elsewhere");
    git(fx.repoDir, "worktree", "move", first.value.path, elsewhere);
    expect(existsSync(elsewhere)).toBe(true);
    const again = await mgr.create(req());
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("WorktreeCreateFailed");
    expect(existsSync(worktreePath())).toBe(false);
  });

  it("create does not run a post-checkout hook when reusing a branch", async () => {
    git(fx.repoDir, "branch", BRANCH, "origin/develop");
    const marker = join(fx.root, "hook-marker");
    installHook(join(fx.repoDir, ".git", "hooks"), marker);
    // Positive check: a plain checkout runs the hook in this environment.
    git(fx.repoDir, "checkout", BRANCH);
    expect(existsSync(marker)).toBe(true);
    git(fx.repoDir, "checkout", "main");
    rmSync(marker, { force: true });

    const result = await mgr.create(req());
    expect(result.ok).toBe(true);
    expect(existsSync(join(worktreePath(), "b.txt"))).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  it("create does not run a filter driver when reusing a branch", async () => {
    const marker = join(fx.root, "smudge-marker");
    const passThrough = ["-c", "filter.x.smudge=cat", "-c", "filter.x.clean=cat"];
    git(fx.repoDir, ...passThrough, "checkout", "-b", BRANCH, "origin/develop");
    writeFileSync(join(fx.repoDir, ".gitattributes"), "* filter=x\n");
    writeFileSync(join(fx.repoDir, "f.dat"), "dado\n");
    git(fx.repoDir, ...passThrough, "add", ".");
    git(fx.repoDir, ...passThrough, "commit", "-m", "attrs");
    git(fx.repoDir, ...passThrough, "checkout", "main");
    git(fx.repoDir, "config", "filter.x.smudge", `touch "${posix(marker)}"; cat`);
    git(fx.repoDir, "config", "filter.x.clean", "cat");
    // Positive check: a plain checkout runs the driver in this environment.
    git(fx.repoDir, "checkout", BRANCH);
    expect(existsSync(marker)).toBe(true);
    git(fx.repoDir, ...passThrough, "checkout", "main");
    rmSync(marker, { force: true });

    const result = await mgr.create(req());
    expect(result.ok).toBe(true);
    expect(existsSync(join(worktreePath(), "f.dat"))).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });
});
