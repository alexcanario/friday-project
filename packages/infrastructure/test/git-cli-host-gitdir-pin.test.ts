import { chmodSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitCliHost } from "../src/index.ts";
import { git, makeRepoFixture, type RepoFixture } from "./git-cli-host-fixture.ts";

let fx: RepoFixture;
const request = () => ({ worktree: fx.wt, branch: "friday/345-x", message: "feat: x" });

function host(afterValidate?: () => Promise<void>): GitCliHost {
  return new GitCliHost({
    tokenEnv: "FRIDAY_AUTHOR_TOKEN",
    repoDir: fx.repoDir,
    mirrorDir: fx.mirror,
    targetUrl: fx.targetUrl,
    env: { ...process.env, FRIDAY_AUTHOR_TOKEN: "ghs_marker_token" },
    ...(afterValidate === undefined ? {} : { afterValidate }),
  });
}

beforeEach(() => {
  fx = makeRepoFixture("git-cli-gitdir-pin-");
  writeFileSync(join(fx.wt, "a.txt"), "changed\n");
});
afterEach(() => rmSync(fx.dir, { recursive: true, force: true }));

describe("GitCliHost gitdir pinning", () => {
  it("keeps the commit in the validated repository when .git is swapped after validation", async () => {
    const other = join(fx.dir, "other");
    git(fx.dir, "init", "-q", other);
    writeFileSync(join(other, "o.txt"), "o\n");
    git(other, "add", "-A");
    git(other, "commit", "-q", "-m", "other");
    git(other, "worktree", "add", "-q", "-b", "friday/345-x", join(fx.dir, "wt-other"));
    const otherGitDir = realpathSync.native(join(other, ".git", "worktrees", "wt-other"));
    const before = git(other, "for-each-ref");
    let swapped = false;
    const swap = async (): Promise<void> => {
      swapped = true;
      const gitFile = join(fx.wt, ".git");
      rmSync(gitFile, { force: true });
      writeFileSync(gitFile, `gitdir: ${otherGitDir}\n`);
      writeFileSync(join(otherGitDir, "gitdir"), `${realpathSync.native(gitFile)}\n`);
    };
    const { sha } = await host(swap).push(request());
    expect(swapped).toBe(true);
    expect(git(other, "for-each-ref")).toBe(before);
    expect(git(fx.remote, "rev-parse", "refs/heads/friday/345-x")).toBe(sha);
  });

  it("still commits and pushes a normal change with the pinned GIT_DIR", async () => {
    const { sha } = await host().push(request());
    expect(git(fx.remote, "rev-parse", "refs/heads/friday/345-x")).toBe(sha);
    expect(git(fx.remote, "show", "-s", "--format=%an|%ae", sha)).toBe(
      "friday-author|friday-author@users.noreply.github.com",
    );
    expect(git(fx.remote, "show", `${sha}:a.txt`)).toBe("changed");
  });

  it("does not pass GIT_DIR to fetch or push", async () => {
    const log = join(fx.dir, "calls.jsonl");
    const bin = join(fx.dir, "spy-git.mjs");
    writeFileSync(
      bin,
      `#!${process.execPath}
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, env: process.env }) + "\\n");
const r = spawnSync("git", argv, { stdio: "inherit", env: process.env });
process.exit(r.status ?? 1);
`,
    );
    chmodSync(bin, 0o755);
    const h = new GitCliHost({
      tokenEnv: "FRIDAY_AUTHOR_TOKEN",
      repoDir: fx.repoDir,
      mirrorDir: fx.mirror,
      targetUrl: fx.targetUrl,
      env: { ...process.env, FRIDAY_AUTHOR_TOKEN: "ghs_marker_token" },
      gitBinary: bin,
    });
    await h.push(request());
    const calls = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { argv: string[]; env: Record<string, string> });
    const net = calls.filter((c) => c.argv.includes("fetch") || c.argv.includes("push"));
    expect(net).toHaveLength(2);
    for (const c of net) expect("GIT_DIR" in c.env).toBe(false);
    const commitSteps = calls.filter(
      (c) =>
        !net.includes(c) &&
        !c.argv.includes("init") &&
        !c.argv.includes("--git-dir") &&
        !c.argv.includes("^hook\\."),
    );
    for (const c of commitSteps) expect(c.env.GIT_DIR).toBeTruthy();
  });
});
