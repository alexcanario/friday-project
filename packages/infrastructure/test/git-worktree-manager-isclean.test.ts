import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GitWorktreeManager } from "../src/git-worktree-manager.ts";
import { addEmbeddedFilterRepo, git, makeFixture, type Fixture } from "./worktree-helpers.ts";

let fx: Fixture;
let mgr: GitWorktreeManager;
let path: string;

const slash = (p: string): string => p.replace(/\\/g, "/");

/** Writes an executable `#!/bin/sh` script that creates `marker` and returns its path. */
function markerScript(dir: string, name: string, marker: string): string {
  mkdirSync(dir, { recursive: true });
  const script = join(dir, name);
  writeFileSync(script, `#!/bin/sh\ntouch "${slash(marker)}"\n`);
  chmodSync(script, 0o755);
  return slash(script);
}

/** A repository other than the daemon's, with one commit and a tracked file. */
function makeOtherRepo(name: string): string {
  const dir = join(fx.root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  for (const [k, v] of [
    ["user.email", "t@t.t"],
    ["user.name", "t"],
    ["commit.gpgsign", "false"],
  ] as const)
    git(dir, "config", k, v);
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

const repointGitfile = (target: string): void => {
  rmSync(join(path, ".git"), { force: true });
  writeFileSync(join(path, ".git"), `gitdir: ${slash(target)}\n`);
};

const advanceMtime = (file: string): void => {
  const later = new Date(Date.now() + 60_000);
  utimesSync(file, later, later);
};

beforeEach(async () => {
  fx = makeFixture();
  mgr = new GitWorktreeManager({ repoDir: fx.repoDir });
  const created = await mgr.create({
    root: fx.root,
    project: fx.project,
    issue: 470,
    title: "Protege",
    base: "develop",
  });
  if (!created.ok) throw new Error(created.error.message);
  path = created.value.path;
});

describe("GitWorktreeManager.isClean", { timeout: 30_000 }, () => {
  it("gitdir de outro repositório com fsmonitor não executa e não é limpo", async () => {
    const head = git(path, "rev-parse", "HEAD");
    const marker = join(fx.root, "fsmonitor-marker");
    const evil = makeOtherRepo("evil");
    git(evil, "config", "core.fsmonitor", markerScript(join(fx.root, "scripts"), "fsm.sh", marker));
    repointGitfile(join(evil, ".git"));
    expect(await mgr.isClean(path, head)).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  it("worktree ligado de outro repositório não é aceito e não executa fsmonitor", async () => {
    const head = git(path, "rev-parse", "HEAD");
    const marker = join(fx.root, "fsmonitor-linked-marker");
    const evil = makeOtherRepo("evil-linked");
    const evilWt = join(fx.root, "evil-linked-wt");
    git(evil, "worktree", "add", "-q", "--detach", evilWt);
    git(
      evil,
      "config",
      "core.fsmonitor",
      markerScript(join(fx.root, "scripts"), "fsm2.sh", marker),
    );
    const linked = readdirSync(join(evil, ".git", "worktrees"))[0]!;
    const linkedDir = join(evil, ".git", "worktrees", linked);
    writeFileSync(join(linkedDir, "gitdir"), `${slash(join(path, ".git"))}\n`);
    repointGitfile(linkedDir);
    expect(await mgr.isClean(path, head)).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  it("gitdir de outro repositório com hook post-index-change não executa e não é limpo", async () => {
    const head = git(path, "rev-parse", "HEAD");
    const marker = join(fx.root, "hook-marker");
    const evil = makeOtherRepo("evil-hook");
    const hooks = join(fx.root, "evil-hooks");
    markerScript(hooks, "post-index-change", marker);
    git(evil, "config", "core.hooksPath", slash(hooks));
    repointGitfile(join(evil, ".git"));
    expect(await mgr.isClean(path, head)).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  it("gitfile ausente ou inválido devolve false", async () => {
    const head = git(path, "rev-parse", "HEAD");
    rmSync(join(path, ".git"), { force: true });
    writeFileSync(join(path, ".git"), "isto não é um gitfile\n");
    expect(await mgr.isClean(path, head)).toBe(false);
    rmSync(join(path, ".git"), { force: true });
    expect(await mgr.isClean(path, head)).toBe(false);
  });

  it("worktree legítimo e limpo no head é limpo (sha curto e completo)", async () => {
    const head = git(path, "rev-parse", "HEAD");
    expect(await mgr.isClean(path, head)).toBe(true);
    expect(await mgr.isClean(path, head.slice(0, 7))).toBe(true);
  });

  it("worktree legítimo sujo, em outro commit ou com head inválido não é limpo", async () => {
    const head = git(path, "rev-parse", "HEAD");
    const other = git(fx.repoDir, "rev-parse", "main");
    expect(other).not.toBe(head);
    expect(await mgr.isClean(path, other)).toBe(false);
    expect(await mgr.isClean(path, "--help")).toBe(false);
    expect(await mgr.isClean(path, "d".repeat(40))).toBe(false);
    writeFileSync(join(path, "untracked.txt"), "x\n");
    expect(await mgr.isClean(path, head)).toBe(false);
    rmSync(join(path, "untracked.txt"));
    expect(await mgr.isClean(path, head)).toBe(true);
    writeFileSync(join(path, "a.txt"), "alterado\n");
    expect(await mgr.isClean(path, head)).toBe(false);
  });

  it("filtro clean do repositório não é executado", async () => {
    const head = git(path, "rev-parse", "HEAD");
    const marker = join(fx.root, "filter-marker");
    const script = markerScript(join(fx.root, "scripts"), "clean.sh", marker);
    git(fx.repoDir, "config", "filter.x.clean", script);
    writeFileSync(join(fx.repoDir, ".git", "info", "attributes"), "* filter=x\n");
    advanceMtime(join(path, "a.txt"));
    await mgr.isClean(path, head);
    expect(existsSync(marker)).toBe(false);
  });

  it("fsmonitor e hook post-index-change do repositório não são executados no worktree legítimo", async () => {
    const head = git(path, "rev-parse", "HEAD");
    const fsMarker = join(fx.root, "legit-fsmonitor-marker");
    const hookMarker = join(fx.root, "legit-hook-marker");
    const hooks = join(fx.root, "legit-hooks");
    markerScript(hooks, "post-index-change", hookMarker);
    git(
      fx.repoDir,
      "config",
      "core.fsmonitor",
      markerScript(join(fx.root, "scripts"), "f.sh", fsMarker),
    );
    git(fx.repoDir, "config", "core.hooksPath", slash(hooks));
    advanceMtime(join(path, "a.txt"));
    await mgr.isClean(path, head);
    expect(existsSync(fsMarker)).toBe(false);
    expect(existsSync(hookMarker)).toBe(false);
  });

  it("submódulo embutido com filtro clean não é executado", async () => {
    const marker = join(fx.root, "sub-filter-marker");
    const script = markerScript(join(fx.root, "scripts"), "sub.sh", marker);
    const head = addEmbeddedFilterRepo(path, script);
    await mgr.isClean(path, head);
    expect(existsSync(marker)).toBe(false);
  });
});
