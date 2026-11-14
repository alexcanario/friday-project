import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const IDENT = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: { ...process.env, ...IDENT },
    encoding: "utf8",
  }).trim();
}

export interface RepoFixture {
  dir: string;
  repoDir: string;
  remote: string;
  wt: string;
  mirror: string;
  targetUrl: string;
}

/** Bare remote plus a real linked worktree (its `.git` is a file), as the worktree manager creates. */
export function makeRepoFixture(prefix: string): RepoFixture {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const remote = join(dir, "remote.git");
  const base = join(dir, "base");
  const wt = join(dir, "wt");
  git(dir, "init", "--bare", "-q", remote);
  git(dir, "init", "-q", base);
  writeFileSync(join(base, "a.txt"), "base\n");
  git(base, "add", "-A");
  git(base, "commit", "-q", "-m", "base");
  git(base, "worktree", "add", "-q", "-b", "friday/345-x", wt);
  return {
    dir,
    repoDir: base,
    remote,
    wt,
    mirror: join(dir, "mirror"),
    targetUrl: `file://${remote}`,
  };
}

/** Writes an executable sh script (chmod keeps it runnable on CI) that appends `body` output to a marker. */
export function markerScript(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}
