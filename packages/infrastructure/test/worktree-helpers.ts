import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

export interface Fixture {
  repoDir: string;
  root: string;
  project: string;
}

/** Temporary repo with a local `origin`, branches `main` and `develop` at different commits. */
export function makeFixture(): Fixture {
  // Long form: on Windows tmpdir() may be an 8.3 name (RUNNER~1) while git reports the long one.
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), "friday-wt-")));
  const origin = join(base, "origin.git");
  const repoDir = join(base, "repo");
  mkdirSync(origin);
  git(origin, "init", "--bare", "-b", "main");
  mkdirSync(repoDir);
  git(repoDir, "init", "-b", "main");
  for (const [k, v] of [
    ["user.email", "t@t.t"],
    ["user.name", "t"],
    ["commit.gpgsign", "false"],
  ] as const)
    git(repoDir, "config", k, v);
  writeFileSync(join(repoDir, "a.txt"), "a\n");
  git(repoDir, "add", ".");
  git(repoDir, "commit", "-m", "init");
  git(repoDir, "remote", "add", "origin", origin);
  git(repoDir, "push", "origin", "main");
  git(repoDir, "checkout", "-b", "develop");
  writeFileSync(join(repoDir, "b.txt"), "b\n");
  git(repoDir, "add", ".");
  git(repoDir, "commit", "-m", "develop");
  git(repoDir, "push", "origin", "develop");
  git(repoDir, "checkout", "main");
  return { repoDir, root: join(base, "wt"), project: "proj" };
}

export function commitOnDevelop(fx: Fixture, name: string): string {
  git(fx.repoDir, "checkout", "develop");
  writeFileSync(join(fx.repoDir, name), name);
  git(fx.repoDir, "add", ".");
  git(fx.repoDir, "commit", "-m", name);
  git(fx.repoDir, "push", "origin", "develop");
  const sha = git(fx.repoDir, "rev-parse", "HEAD");
  git(fx.repoDir, "checkout", "main");
  return sha;
}

/**
 * Creates `sub/` inside the worktree as an embedded repository recorded as a gitlink and committed,
 * whose own config defines a `clean` filter that creates `marker`; advances the mtime of its file.
 * Returns the new HEAD of the worktree.
 */
export function addEmbeddedFilterRepo(worktree: string, script: string): string {
  const sub = join(worktree, "sub");
  mkdirSync(sub);
  git(sub, "init", "-q", "-b", "main");
  for (const [k, v] of [
    ["user.email", "t@t.t"],
    ["user.name", "t"],
    ["commit.gpgsign", "false"],
  ] as const)
    git(sub, "config", k, v);
  writeFileSync(join(sub, "f.txt"), "f\n");
  git(sub, "add", ".");
  git(sub, "commit", "-q", "-m", "sub");
  git(worktree, "add", "sub");
  git(worktree, "commit", "-q", "-m", "gitlink");
  git(sub, "config", "filter.y.clean", script);
  writeFileSync(join(sub, ".gitattributes"), "* filter=y\n");
  const later = new Date(Date.now() + 60_000);
  utimesSync(join(sub, "f.txt"), later, later);
  return git(worktree, "rev-parse", "HEAD");
}
