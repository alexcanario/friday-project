import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GitWorktreeManager } from "../src/git-worktree-manager.ts";
import { commitOnDevelop, git, makeFixture, type Fixture } from "./worktree-helpers.ts";

let fx: Fixture;
let mgr: GitWorktreeManager;
const posix = (p: string): string => p.split("\\").join("/");
const req = (issue: number, title: string) => ({
  root: fx.root,
  project: fx.project,
  issue,
  title,
  base: "develop",
});
const pathOf = (issue: number): string => join(fx.root, fx.project, String(issue));

beforeEach(() => {
  fx = makeFixture();
  mgr = new GitWorktreeManager({ repoDir: fx.repoDir });
  mkdirSync(fx.root, { recursive: true });
});

function installPostCheckout(hooksDir: string, marker: string): void {
  mkdirSync(hooksDir, { recursive: true });
  const hook = join(hooksDir, "post-checkout");
  writeFileSync(hook, `#!/bin/sh\ntouch "${posix(marker)}"\n`);
  chmodSync(hook, 0o755);
}

/** True when this git runs config-defined hooks and lists `name` for `event`. */
function supportsConfigHooks(event: string, name: string): boolean {
  try {
    const dir = mkdtempSync(join(tmpdir(), "friday-hook-probe-"));
    git(dir, "init", "-q");
    git(dir, "config", `hook.${name}.event`, event);
    git(dir, "config", `hook.${name}.command`, "true");
    return git(dir, "hook", "list", event).includes(name);
  } catch {
    return false;
  }
}

describe("GitWorktreeManager protected git", { timeout: 60_000 }, () => {
  it("create runs no post-checkout hook from core.hooksPath (new branch and reused branch)", async () => {
    const hooks = join(fx.root, "hooks");
    const marker = join(fx.root, "marker");
    installPostCheckout(hooks, marker);
    git(fx.repoDir, "config", "core.hooksPath", hooks);

    const fresh = await mgr.create(req(21, "Nova"));
    expect(fresh.ok).toBe(true);
    expect(existsSync(marker)).toBe(false);
    // Reused branch: folder deleted by hand, the local branch stays.
    rmSync(pathOf(21), { recursive: true, force: true });
    const reused = await mgr.create(req(21, "Nova"));
    expect(reused.ok).toBe(true);
    expect(existsSync(marker)).toBe(false);
    // Positive check: a plain `git worktree add` with the same config does run the hook.
    git(fx.repoDir, "worktree", "add", "-q", "-b", "plain", join(fx.root, "plain"));
    expect(existsSync(marker)).toBe(true);
  });

  it("list and remove ignore GIT_DIR of the daemon environment", async () => {
    const other = makeFixture();
    const created = await mgr.create(req(22, "Lista"));
    if (!created.ok) throw new Error(created.error.message);
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = join(other.repoDir, ".git");
    try {
      const listed = await mgr.list({ root: fx.root, project: fx.project });
      expect(listed.ok).toBe(true);
      if (listed.ok) expect(listed.value.map((w) => w.issue)).toContain(22);
      const removed = await mgr.remove({ root: fx.root, project: fx.project, issue: 22 });
      expect(removed.ok).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
    expect(git(fx.repoDir, "worktree", "list", "--porcelain")).not.toContain(posix(pathOf(22)));
  });

  it("create and alignTo run no config-defined hook (hook.<name>.command)", async (ctx) => {
    if (!supportsConfigHooks("post-checkout", "probe")) ctx.skip();
    const hook = (name: string, marker: string): void => {
      git(fx.repoDir, "config", `hook.${name}.event`, "post-checkout");
      git(fx.repoDir, "config", `hook.${name}.command`, `touch "${posix(marker)}"; :`);
    };
    const markers = ["fresh", "reused", "align"].map((n) => join(fx.root, `m-${n}`));
    hook("fresh", markers[0]!);
    const fresh = await mgr.create(req(23, "Hook nova"));
    expect(fresh.ok).toBe(true);
    expect(existsSync(markers[0]!), "new branch").toBe(false);
    hook("reused", markers[1]!);
    rmSync(pathOf(23), { recursive: true, force: true });
    const reused = await mgr.create(req(23, "Hook nova"));
    expect(reused.ok).toBe(true);
    expect(existsSync(markers[1]!), "reused branch").toBe(false);
    // Configured only now, so the worktree is clean and the hook can only come from `alignTo`.
    const sha = commitOnDevelop(fx, "novo.txt");
    hook("align", markers[2]!);
    const aligned = await mgr.alignTo(pathOf(23), sha);
    expect(aligned.ok).toBe(true);
    expect(git(pathOf(23), "rev-parse", "HEAD")).toBe(sha);
    expect(existsSync(markers[2]!), "alignTo").toBe(false);
    // Positive check: a plain `git worktree add` runs the configured hooks.
    git(fx.repoDir, "worktree", "add", "-q", "-b", "plain", join(fx.root, "plain"));
    expect(markers.some((m) => existsSync(m))).toBe(true);
  });
});
