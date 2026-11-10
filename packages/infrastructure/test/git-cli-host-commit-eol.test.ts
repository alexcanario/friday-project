import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commitWorktree } from "../src/git-cli-commit.ts";
import { makeEolScenario } from "./eol-scenario.ts";
import { git } from "./worktree-helpers.ts";

let repoDir: string;
let worktree: string;

const commit = () =>
  commitWorktree({
    git: "git",
    worktree,
    message: "fix: x",
    baseEnv: { PATH: process.env.PATH ?? "" },
  }).then((r) => r.sha);
const blob = (path: string): string =>
  execFileSync("git", ["cat-file", "blob", `HEAD:${path}`], { cwd: worktree }).toString("latin1");
const changedFiles = () => git(worktree, "show", "--name-only", "--format=", "HEAD");

beforeEach(async () => {
  ({ repoDir, worktree } = await makeEolScenario());
});
afterEach(() => vi.unstubAllEnvs());

describe("commitWorktree end-of-line handling", () => {
  it("commit adds nothing for an untouched file in a worktree made by the manager", async () => {
    const sha = await commit();
    expect(sha).toBe(git(repoDir, "rev-parse", "origin/develop"));
    expect(() => git(worktree, "diff-index", "--cached", "--quiet", "HEAD")).not.toThrow();
  });

  it("commit includes only the file the agent changed, with LF", async () => {
    writeFileSync(join(worktree, "changed.txt"), "novo\n");
    await commit();
    expect(changedFiles()).toBe("changed.txt");
    expect(blob("changed.txt")).toBe("novo\n");
  });

  it("commit still includes a real content change", async () => {
    writeFileSync(join(worktree, "eol.txt"), "a\nb\nc\n");
    await commit();
    expect(changedFiles()).toContain("eol.txt");
  });

  it("commit step keeps the bytes the agent wrote even with local autocrlf true", async () => {
    git(worktree, "config", "core.autocrlf", "true");
    writeFileSync(join(worktree, "changed.txt"), "x\r\n");
    await commit();
    expect(blob("changed.txt")).toBe("x\r\n");
  });
});
