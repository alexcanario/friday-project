import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commitWorktree } from "../src/git-cli-commit.ts";
import { baseEnv } from "../src/git-worktree-guard.ts";
import { GitCliHost } from "../src/git-cli-host.ts";
import { GitWorktreeManager } from "../src/git-worktree-manager.ts";
import { git, makeFixture, type Fixture } from "./worktree-helpers.ts";

const NOT_OWNED = "o worktree não pertence ao repositório do daemon.";
const fixtures: Fixture[] = [];

/** Never executed: only compiled, so the `@ts-expect-error` lines are checked by tsc. */
export function typeChecks(): void {
  // @ts-expect-error repoDir é obrigatório
  void commitWorktree({ git: "git", worktree: "/w", message: "m", baseEnv: {} });
  // @ts-expect-error repoDir é obrigatório
  void new GitCliHost({ tokenEnv: "FRIDAY_AUTHOR_TOKEN", mirrorDir: "/m", targetUrl: "file:///r" });
}

async function worktreeOf(fx: Fixture, issue: number): Promise<string> {
  const created = await new GitWorktreeManager({ repoDir: fx.repoDir }).create({
    root: fx.root,
    project: fx.project,
    issue,
    title: "Owned",
    base: "develop",
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value.path;
}

function twoRepos(): { a: Fixture; b: Fixture } {
  const a = makeFixture();
  const b = makeFixture();
  fixtures.push(a, b);
  return { a, b };
}

afterEach(() => {
  for (const fx of fixtures.splice(0))
    rmSync(dirname(fx.repoDir), { recursive: true, force: true });
});

describe("commitWorktree ownership", () => {
  it("requires repoDir in CommitRequest and GitCliHostOptions", () => {
    expect(typeChecks).toBeTypeOf("function");
  });

  it("commitWorktree rejects a linked worktree of another repository", async () => {
    const { a, b } = twoRepos();
    const foreign = await worktreeOf(b, 1);
    const before = git(foreign, "rev-parse", "HEAD");
    writeFileSync(join(foreign, "novo.txt"), "novo\n");
    const afterValidate = vi.fn(() => Promise.resolve());
    await expect(
      commitWorktree({
        git: "git",
        repoDir: a.repoDir,
        worktree: foreign,
        message: "novo",
        baseEnv: baseEnv(),
        afterValidate,
      }),
    ).rejects.toThrow(NOT_OWNED);
    expect(git(foreign, "rev-parse", "HEAD")).toBe(before);
    expect(afterValidate).not.toHaveBeenCalled();
  });

  it("commitWorktree commits a worktree owned by repoDir", async () => {
    const { a } = twoRepos();
    const own = await worktreeOf(a, 2);
    const before = git(own, "rev-parse", "HEAD");
    writeFileSync(join(own, "novo.txt"), "novo\n");
    const out = await commitWorktree({
      git: "git",
      repoDir: a.repoDir,
      worktree: own,
      message: "novo",
      baseEnv: baseEnv(),
    });
    expect(out.sha).not.toBe(before);
    expect(out.sha).toBe(git(own, "rev-parse", "HEAD"));
  });

  it("GitCliHost.push rejects a worktree of another repository and leaves the mirror untouched", async () => {
    const { a, b } = twoRepos();
    const foreign = await worktreeOf(b, 3);
    writeFileSync(join(foreign, "novo.txt"), "novo\n");
    const remote = join(dirname(a.repoDir), "origin.git");
    const mirror = join(dirname(a.repoDir), "mirror");
    const host = new GitCliHost({
      tokenEnv: "FRIDAY_AUTHOR_TOKEN",
      repoDir: a.repoDir,
      mirrorDir: mirror,
      targetUrl: `file://${remote.split("\\").join("/")}`,
      env: { ...process.env, FRIDAY_AUTHOR_TOKEN: "ghs_marker_token" },
    });
    const branch = "friday/3-owned";
    await expect(host.push({ worktree: foreign, branch, message: "feat: x" })).rejects.toThrow(
      NOT_OWNED,
    );
    expect(existsSync(join(mirror, "HEAD"))).toBe(false);
    expect(() => git(remote, "rev-parse", "--verify", `refs/heads/${branch}`)).toThrow();
  });
});
