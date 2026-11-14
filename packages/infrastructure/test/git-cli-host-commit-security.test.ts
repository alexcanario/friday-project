import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitCliHost } from "../src/index.ts";
import { git, makeRepoFixture, type RepoFixture } from "./git-cli-host-fixture.ts";

let fx: RepoFixture;
let marker: string;
let script: string;

function host(): GitCliHost {
  return new GitCliHost({
    tokenEnv: "FRIDAY_AUTHOR_TOKEN",
    repoDir: fx.repoDir,
    mirrorDir: fx.mirror,
    targetUrl: fx.targetUrl,
    env: { ...process.env, FRIDAY_AUTHOR_TOKEN: "ghs_marker_token" },
  });
}

function markerScript(path: string, body = `echo ran >> ${marker}`): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

const request = (message = "feat: x") => ({
  worktree: fx.wt,
  branch: "friday/345-x",
  message,
});

beforeEach(() => {
  fx = makeRepoFixture("git-cli-commit-sec-");
  marker = join(fx.dir, "marker.txt");
  script = join(fx.dir, "evil.sh");
  markerScript(script);
  writeFileSync(join(fx.wt, "a.txt"), "changed\n");
});

afterEach(() => {
  rmSync(fx.dir, { recursive: true, force: true });
});

describe("GitCliHost commit security", () => {
  it("does not run planted hooks", async () => {
    const gitDir = git(fx.wt, "rev-parse", "--path-format=absolute", "--git-common-dir");
    const hooksPath = join(fx.dir, "evil-hooks");
    mkdirSync(hooksPath);
    const names = ["pre-commit", "commit-msg", "post-commit", "pre-push", "reference-transaction"];
    mkdirSync(join(gitDir, "hooks"), { recursive: true });
    for (const name of names) {
      for (const base of [join(gitDir, "hooks"), hooksPath]) {
        markerScript(join(base, name), `echo ${name} >> ${marker}`);
      }
    }
    git(fx.wt, "config", "core.hooksPath", hooksPath);
    const { sha } = await host().push(request());
    expect(git(fx.remote, "rev-parse", "refs/heads/friday/345-x")).toBe(sha);
    expect(existsSync(marker)).toBe(false);
  });

  it("does not run fsmonitor, clean filters or gpg program", async () => {
    git(fx.wt, "config", "core.fsmonitor", script);
    git(fx.wt, "config", "filter.evil.clean", script);
    git(fx.wt, "config", "filter.evil.process", script);
    git(fx.wt, "config", "commit.gpgSign", "true");
    git(fx.wt, "config", "gpg.program", script);
    writeFileSync(join(fx.wt, ".gitattributes"), "*.txt filter=evil\n");
    const { sha } = await host().push(request());
    expect(existsSync(marker)).toBe(false);
    expect(git(fx.wt, "show", `${sha}:a.txt`)).toBe("changed");
  });

  it("commits only the worktree when .git is redirected with core.worktree", async () => {
    const outside = join(fx.dir, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "segredo.txt"), "secret\n");
    git(fx.wt, "config", "core.worktree", outside);
    const { sha } = await host().push(request());
    const files = git(fx.wt, "ls-tree", "-r", "--name-only", sha).split("\n");
    expect(files).toContain("a.txt");
    expect(files).not.toContain("segredo.txt");
    expect(git(fx.wt, "show", `${sha}:a.txt`)).toBe("changed");
  });

  it("rejects a .git that is a directory or points outside a linked worktree", async () => {
    const gitFile = join(fx.wt, ".git");
    // On Windows git marks .git as hidden, and opening a hidden file for writing fails with EPERM.
    rmSync(gitFile, { force: true });
    writeFileSync(gitFile, `gitdir: ${join(fx.dir, "elsewhere")}\n`);
    await expect(host().push(request())).rejects.toThrow(/^Falha ao validar o worktree: /);
    rmSync(gitFile);
    mkdirSync(gitFile);
    await expect(host().push(request())).rejects.toThrow(/^Falha ao validar o worktree: /);
  });

  it("rejects a .git pointing at a fake worktrees/<n> inside the worktree with a foreign commondir", async () => {
    const other = join(fx.dir, "other");
    git(fx.dir, "init", "-q", other);
    writeFileSync(join(other, "o.txt"), "o\n");
    git(other, "add", "-A");
    git(other, "commit", "-q", "-m", "other");
    const before = git(other, "for-each-ref");
    const fake = join(fx.wt, "x", "worktrees", "y");
    mkdirSync(fake, { recursive: true });
    writeFileSync(join(fake, "HEAD"), "ref: refs/heads/friday/345-x\n");
    writeFileSync(join(fake, "commondir"), `${join(other, ".git")}\n`);
    writeFileSync(join(fake, "gitdir"), `${join(fx.wt, ".git")}\n`);
    rmSync(join(fx.wt, ".git"), { force: true });
    writeFileSync(join(fx.wt, ".git"), `gitdir: ${fake}\n`);
    await expect(host().push(request())).rejects.toThrow(/^Falha ao validar o worktree: /);
    expect(git(other, "for-each-ref")).toBe(before);
  });

  it("rejects a .git pointing at the worktrees/<n> of another worktree", async () => {
    const base = join(fx.dir, "base");
    const wt2 = join(fx.dir, "wt2");
    git(base, "worktree", "add", "-q", "-b", "friday/346-y", wt2);
    const before = git(base, "for-each-ref");
    const gitDir2 = readFileSync(join(wt2, ".git"), "utf8")
      .replace(/^gitdir: /, "")
      .trim();
    rmSync(join(fx.wt, ".git"), { force: true });
    writeFileSync(join(fx.wt, ".git"), `gitdir: ${gitDir2}\n`);
    await expect(host().push(request())).rejects.toThrow(/^Falha ao validar o worktree: /);
    expect(git(base, "for-each-ref")).toBe(before);
  });

  it("commits with the fixed identity when author and committer config are planted", async () => {
    for (const key of ["author", "committer"]) {
      git(fx.wt, "config", `${key}.name`, "evil");
      git(fx.wt, "config", `${key}.email`, "evil@example.com");
    }
    git(fx.wt, "config", "user.name", "evil");
    git(fx.wt, "config", "user.email", "evil@example.com");
    const { sha } = await host().push(request());
    const who = git(fx.wt, "show", "-s", "--format=%an|%ae|%cn|%ce", sha);
    const id = "friday-author|friday-author@users.noreply.github.com";
    expect(who).toBe(`${id}|${id}`);
  });
});
