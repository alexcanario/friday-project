import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GitCliHost } from "../src/git-cli-host.ts";
import { GitWorktreeManager } from "../src/git-worktree-manager.ts";
import {
  addEmbeddedFilterRepo,
  commitOnDevelop,
  git,
  makeFixture,
  type Fixture,
} from "./worktree-helpers.ts";

let fx: Fixture;
let mgr: GitWorktreeManager;
let path: string;

/** Installs a `post-checkout` hook that creates `marker` when it runs. */
function installHook(hooksDir: string, marker: string): void {
  mkdirSync(hooksDir, { recursive: true });
  const hook = join(hooksDir, "post-checkout");
  writeFileSync(hook, `#!/bin/sh\ntouch "${marker.replace(/\\/g, "/")}"\n`);
  chmodSync(hook, 0o755);
}

beforeEach(async () => {
  fx = makeFixture();
  mgr = new GitWorktreeManager({ repoDir: fx.repoDir });
  const created = await mgr.create({
    root: fx.root,
    project: fx.project,
    issue: 15,
    title: "Alinha",
    base: "develop",
  });
  if (!created.ok) throw new Error(created.error.message);
  path = created.value.path;
});

describe("GitWorktreeManager.alignTo", { timeout: 30_000 }, () => {
  it("alinha o worktree a um commit do origin", async () => {
    const sha = commitOnDevelop(fx, "novo.txt");
    expect(git(path, "rev-parse", "HEAD")).not.toBe(sha);
    const result = await mgr.alignTo(path, sha);
    expect(result).toEqual({ ok: true, value: undefined });
    expect(git(path, "rev-parse", "HEAD")).toBe(sha);
  });

  it.each([["--help"], ["a".repeat(39)], ["A".repeat(40)], [`${"a".repeat(40)} --force`]])(
    "recusa sha inválido sem chamar o git (%s)",
    async (sha) => {
      const before = git(path, "rev-parse", "HEAD");
      // A path that is not a repository: any git call would fail with another message and code path.
      const result = await mgr.alignTo(join(fx.root, "nao-existe"), sha);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("WorktreeCreateFailed");
        expect(result.error.message).toMatch(/sha/i);
      }
      expect(git(path, "rev-parse", "HEAD")).toBe(before);
    },
  );

  it("recusa worktree sujo sem mexer nele", async () => {
    const sha = commitOnDevelop(fx, "novo.txt");
    const before = git(path, "rev-parse", "HEAD");
    writeFileSync(join(path, "b.txt"), "alterado\n");
    const result = await mgr.alignTo(path, sha);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WorktreeCreateFailed");
    expect(git(path, "rev-parse", "HEAD")).toBe(before);
    expect(git(path, "status", "--porcelain")).toContain("b.txt");
    expect(git(path, "show", "HEAD:b.txt")).toBe("b");
  });

  it("recusa um sha que o origin não tem", async () => {
    const result = await mgr.alignTo(path, "c".repeat(40));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WorktreeCreateFailed");
  });

  it("recusa worktree cujo .git aponta para outro gitdir e não executa o hook dele", async () => {
    const sha = commitOnDevelop(fx, "novo.txt");
    const marker = join(fx.root, "evil-marker");
    const evil = join(fx.root, "evil");
    mkdirSync(evil, { recursive: true });
    git(evil, "init", "-q", "-b", "main");
    git(evil, "config", "core.fsmonitor", `touch ${JSON.stringify(marker.replace(/\\/g, "/"))}`);
    installHook(join(evil, ".git", "hooks"), marker);
    rmSync(join(path, ".git"), { force: true });
    writeFileSync(join(path, ".git"), `gitdir: ${join(evil, ".git")}\n`);
    const result = await mgr.alignTo(path, sha);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WorktreeCreateFailed");
    expect(existsSync(marker)).toBe(false);
  });

  it("não executa o comando smudge configurado no repositório comum", async () => {
    const marker = join(fx.root, "smudge-marker").replace(/\\/g, "/");
    git(fx.repoDir, "config", "filter.x.smudge", `touch "${marker}"; cat`);
    git(fx.repoDir, "config", "filter.x.clean", "cat");
    git(fx.repoDir, "checkout", "develop");
    writeFileSync(join(fx.repoDir, ".gitattributes"), "*.dat filter=x\n");
    writeFileSync(join(fx.repoDir, "f.dat"), "dado\n");
    git(fx.repoDir, "-c", "filter.x.smudge=cat", "add", ".");
    git(fx.repoDir, "-c", "filter.x.smudge=cat", "commit", "-m", "attrs");
    git(fx.repoDir, "push", "origin", "develop");
    const sha = git(fx.repoDir, "rev-parse", "HEAD");
    git(fx.repoDir, "-c", "filter.x.smudge=cat", "checkout", "main");
    rmSync(marker, { force: true });
    const result = await mgr.alignTo(path, sha);
    expect(result.ok).toBe(true);
    expect(existsSync(join(path, "f.dat"))).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  it("não executa o hook post-checkout do repositório comum num alinhamento bem-sucedido", async () => {
    const sha = commitOnDevelop(fx, "novo.txt");
    const marker = join(fx.root, "hook-marker");
    installHook(join(fx.repoDir, ".git", "hooks"), marker);
    expect((await mgr.alignTo(path, sha)).ok).toBe(true);
    expect(git(path, "rev-parse", "HEAD")).toBe(sha);
    expect(existsSync(marker)).toBe(false);
  });

  it("push depois do alinhamento avança a branch do PR", async () => {
    const sha = commitOnDevelop(fx, "novo.txt");
    const origin = join(fx.repoDir, "..", "origin.git");
    git(origin, "update-ref", "refs/heads/friday/15-alinha", sha);
    expect((await mgr.alignTo(path, sha)).ok).toBe(true);
    writeFileSync(join(path, "c.txt"), "c\n");
    const host = new GitCliHost({
      tokenEnv: "FRIDAY_TEST_TOKEN",
      mirrorDir: join(fx.repoDir, "..", "mirror"),
      targetUrl: `file://${origin.replace(/\\/g, "/")}`,
      env: { ...process.env, FRIDAY_TEST_TOKEN: "t" },
    });
    const pushed = await host.push({
      worktree: path,
      branch: "friday/15-alinha",
      message: "feat: c",
    });
    expect(git(origin, "rev-parse", "refs/heads/friday/15-alinha")).toBe(pushed.sha);
    expect(pushed.sha).not.toBe(sha);
    expect(git(origin, "rev-parse", `${pushed.sha}^`)).toBe(sha);
    rmSync(join(fx.repoDir, "..", "mirror"), { recursive: true, force: true });
  });

  it("não executa o filtro clean de um submódulo embutido no worktree", async () => {
    const marker = join(fx.root, "sub-filter-marker");
    const script = join(fx.root, "sub-filter.sh");
    const slash = (p: string): string => p.replace(/\\/g, "/");
    writeFileSync(script, `#!/bin/sh\ntouch "${slash(marker)}"\n`);
    chmodSync(script, 0o755);
    addEmbeddedFilterRepo(path, slash(script));
    const sha = commitOnDevelop(fx, "novo.txt");
    await mgr.alignTo(path, sha);
    expect(existsSync(marker)).toBe(false);
  });
});
