import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitWorktreeManager, branchName } from "../src/git-worktree-manager.ts";
import { commitOnDevelop, git, makeFixture, type Fixture } from "./worktree-helpers.ts";

let fx: Fixture;
let mgr: GitWorktreeManager;
const req = (issue: number, title = "Titulo") => ({
  root: fx.root,
  project: fx.project,
  issue,
  title,
  base: "develop",
});

beforeEach(() => {
  fx = makeFixture();
  mgr = new GitWorktreeManager({ repoDir: fx.repoDir });
});

describe("GitWorktreeManager", () => {
  it("create makes the worktree directory and rejects a duplicate", async () => {
    const r = await mgr.create(req(15));
    const path = join(fx.root, fx.project, "15");
    expect(r).toEqual({ ok: true, value: { path } });
    expect(existsSync(path)).toBe(true);
    const again = await mgr.create(req(15));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("WorktreeExists");
    expect(existsSync(path)).toBe(true);
  });

  it("create checks out the branch and base defined by the owner", async () => {
    const r = await mgr.create(req(15, "Gerenciador de Worktrees!"));
    if (!r.ok) throw new Error("create failed");
    const p = r.value.path;
    expect(git(p, "rev-parse", "--abbrev-ref", "HEAD")).toBe("friday/15-gerenciador-de-worktrees");
    const dev = git(fx.repoDir, "rev-parse", "origin/develop");
    expect(git(p, "rev-parse", "HEAD")).toBe(dev);
    expect(dev).not.toBe(git(fx.repoDir, "rev-parse", "origin/main"));
    const newer = commitOnDevelop(fx, "c.txt");
    // Local ref back to the old commit: only a real fetch can bring the new one.
    git(fx.repoDir, "update-ref", "refs/remotes/origin/develop", dev);
    expect(git(fx.repoDir, "rev-parse", "origin/develop")).toBe(dev);
    const r2 = await mgr.create(req(16, "Outra"));
    if (!r2.ok) throw new Error("create failed");
    expect(git(r2.value.path, "rev-parse", "HEAD")).toBe(newer);
    git(fx.repoDir, "branch", "friday/17-existente");
    const r3 = await mgr.create(req(17, "Existente"));
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.error.code).toBe("WorktreeCreateFailed");
  });

  it("list returns only issue worktrees and [] when empty", async () => {
    expect(await mgr.list({ root: fx.root, project: fx.project })).toEqual({ ok: true, value: [] });
    const c = await mgr.create(req(15));
    if (!c.ok) throw new Error("create failed");
    const r = await mgr.list({ root: fx.root, project: fx.project });
    expect(r).toEqual({
      ok: true,
      value: [{ issue: 15, path: c.value.path, head: git(c.value.path, "rev-parse", "HEAD") }],
    });
  });

  it("remove deletes directory and git entry and is idempotent", async () => {
    await mgr.create(req(15));
    const path = join(fx.root, fx.project, "15");
    const rm = { root: fx.root, project: fx.project, issue: 15 };
    expect((await mgr.remove(rm)).ok).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(git(fx.repoDir, "worktree", "list", "--porcelain")).not.toContain(path);
    expect((await mgr.remove(rm)).ok).toBe(true);
    expect(git(fx.repoDir, "branch", "--list", "friday/15-titulo")).toContain("friday/15-titulo");
  });

  it("listOrphans excludes active issues and ignores non-worktree dirs", async () => {
    await mgr.create(req(15));
    await mgr.create(req(16));
    mkdirSync(join(fx.root, fx.project, "99"), { recursive: true });
    const p = { root: fx.root, project: fx.project };
    const issues = async (activeIssues: number[]) => {
      const r = await mgr.listOrphans({ ...p, activeIssues });
      if (!r.ok) throw new Error("listOrphans failed");
      return r.value.map((w) => w.issue).sort();
    };
    expect(await issues([15])).toEqual([16]);
    expect(await issues([15, 16])).toEqual([]);
    expect(await issues([])).toEqual([15, 16]);
  });

  it("isClean is true for a fresh worktree at the expected head", async () => {
    const c = await mgr.create(req(15));
    if (!c.ok) throw new Error("create failed");
    expect(await mgr.isClean(c.value.path, git(c.value.path, "rev-parse", "HEAD"))).toBe(true);
  });

  it("isClean is false for a modified file, an untracked file, a new commit and an unknown head", async () => {
    const c = await mgr.create(req(15));
    if (!c.ok) throw new Error("create failed");
    const p = c.value.path;
    const head = git(p, "rev-parse", "HEAD");
    expect(await mgr.isClean(p, "0000000")).toBe(false);
    writeFileSync(join(p, "a.txt"), "changed\n");
    expect(await mgr.isClean(p, head)).toBe(false);
    git(p, "checkout", "--", "a.txt");
    writeFileSync(join(p, "new.txt"), "x");
    expect(await mgr.isClean(p, head)).toBe(false);
    git(p, "add", ".");
    git(p, "-c", "user.email=t@t.t", "-c", "user.name=t", "commit", "-m", "x");
    expect(await mgr.isClean(p, head)).toBe(false);
  });

  it("builds the branch name from the title", () => {
    expect(branchName(16, "Porta AgentRuntime: adaptador")).toBe(
      "friday/16-porta-agentruntime-adaptador",
    );
    expect(branchName(7, "Ação rápida")).toBe("friday/7-acao-rapida");
    expect(branchName(7, "!!!")).toBe("friday/7");
    expect(branchName(7, "a".repeat(100))).toBe(`friday/7-${"a".repeat(40)}`);
    expect(branchName(7, "a".repeat(39) + " b").endsWith("-")).toBe(false);
  });

  it("waits 200 ms between attempts", async () => {
    const sleep = vi.fn(async () => {});
    const removeDir = vi.fn(async () => {
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    });
    const m = new GitWorktreeManager({ repoDir: fx.repoDir, removeDir, sleep });
    await m.create(req(15));
    await m.remove({ root: fx.root, project: fx.project, issue: 15 });
    expect(sleep.mock.calls).toEqual([[200], [200]]);
  });

  it("isClean sees untracked files even when git config hides them", async () => {
    const c = await mgr.create(req(15));
    if (!c.ok) throw new Error("create failed");
    const p = c.value.path;
    const head = git(p, "rev-parse", "HEAD");
    git(p, "config", "status.showUntrackedFiles", "no");
    writeFileSync(join(p, "novo.txt"), "x");
    expect(await mgr.isClean(p, head)).toBe(false);
  });

  it("isClean accepts the commit by short or full sha and refuses a bare prefix of another", async () => {
    const c = await mgr.create(req(15));
    if (!c.ok) throw new Error("create failed");
    const p = c.value.path;
    const head = git(p, "rev-parse", "HEAD");
    expect(await mgr.isClean(p, head)).toBe(true);
    expect(await mgr.isClean(p, head.slice(0, 7))).toBe(true);
    expect(await mgr.isClean(p, "abcdef0")).toBe(head.startsWith("abcdef0"));
  });

  it("list keeps a worktree under a root with accents", async () => {
    const root = join(mkdtempSync(join(tmpdir(), "friday-wt-")), "ação");
    const created = await mgr.create({ ...req(15), root });
    if (!created.ok) throw new Error("create failed");
    const r = await mgr.list({ root, project: fx.project });
    expect(r.ok && r.value.map((w) => w.issue)).toEqual([15]);
  });

  it("refuses a project folder that is a link out of the root", async () => {
    const outside = mkdtempSync(join(tmpdir(), "friday-out-"));
    const victim = join(outside, "15");
    mkdirSync(victim);
    writeFileSync(join(victim, "keep.txt"), "x");
    mkdirSync(fx.root, { recursive: true });
    symlinkSync(outside, join(fx.root, fx.project), "junction");
    const removed = await mgr.remove({ root: fx.root, project: fx.project, issue: 15 });
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.error.code).toBe("InvalidPath");
    expect(existsSync(join(victim, "keep.txt"))).toBe(true);
    const created = await mgr.create(req(16));
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.code).toBe("InvalidPath");
    expect(existsSync(join(outside, "16"))).toBe(false);
  });

  it("refuses a path outside the project folder", async () => {
    await mgr.create(req(15));
    const r = await mgr.remove({ root: fx.root, project: "../x", issue: 15 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("InvalidPath");
    expect(existsSync(join(fx.root, fx.project, "15"))).toBe(true);
  });

  it.each([
    "--upload-pack=touch x",
    "",
    "-x",
    "a..b",
    "a b",
    "a;b",
    "/develop",
    "develop/",
    "a.lock",
  ])("create refuses the invalid base %j and runs nothing", async (base) => {
    const r = await mgr.create({ ...req(15), base });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("WorktreeCreateFailed");
    expect(existsSync(join(fx.root, fx.project, "15"))).toBe(false);
    expect(existsSync(join(fx.root, fx.project))).toBe(false);
    expect(existsSync(join(fx.repoDir, "x"))).toBe(false);
  });

  it("create accepts a base with slashes", async () => {
    git(fx.repoDir, "push", "origin", "develop:refs/heads/release/1.0");
    const r = await mgr.create({ ...req(15), base: "release/1.0" });
    expect(r.ok).toBe(true);
  });

  it("isClean is false for a head that is not 7 or more hex digits", async () => {
    const c = await mgr.create(req(15));
    if (!c.ok) throw new Error("setup");
    expect(await mgr.isClean(c.value.path, "a")).toBe(false);
    expect(await mgr.isClean(c.value.path, "--foo")).toBe(false);
  });
});
