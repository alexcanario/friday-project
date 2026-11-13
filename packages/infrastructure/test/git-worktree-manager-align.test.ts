import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GitCliHost } from "../src/git-cli-host.ts";
import { GitWorktreeManager } from "../src/git-worktree-manager.ts";
import { commitOnDevelop, git, makeFixture, type Fixture } from "./worktree-helpers.ts";

let fx: Fixture;
let mgr: GitWorktreeManager;
let path: string;

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
});
