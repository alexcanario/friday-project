import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorktree } from "../src/worktree.ts";
import { makeRepo, makeTmp } from "./helpers.ts";

describe("createWorktree", () => {
  it("creates a worktree from a git repo", async () => {
    const repo = makeRepo();
    const dir = join(makeTmp(), "wt");
    await createWorktree(repo, dir);
    expect(existsSync(join(dir, "hello.txt"))).toBe(true);
    const list = execFileSync("git", ["worktree", "list"], { cwd: repo, encoding: "utf8" });
    expect(list.trim().split("\n")).toHaveLength(2);
  });

  it("rejects a non-git folder", async () => {
    const folder = makeTmp();
    await expect(createWorktree(folder, join(makeTmp(), "wt"))).rejects.toThrow(
      `repositório git inválido: ${folder}`,
    );
  });
});
