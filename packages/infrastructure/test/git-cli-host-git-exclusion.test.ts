import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitCliHost } from "../src/index.ts";
import { GIT_EXCLUDED_PATHS } from "../src/git-cli-commit.ts";
import { git, makeRepoFixture, type RepoFixture } from "./git-cli-host-fixture.ts";

let fx: RepoFixture;

function host(): GitCliHost {
  return new GitCliHost({
    tokenEnv: "FRIDAY_AUTHOR_TOKEN",
    repoDir: fx.repoDir,
    mirrorDir: fx.mirror,
    targetUrl: fx.targetUrl,
    env: { ...process.env, FRIDAY_AUTHOR_TOKEN: "ghs_marker_token" },
  });
}

const push = () => host().push({ worktree: fx.wt, branch: "friday/345-x", message: "feat: x" });

function put(rel: string, content: string): void {
  const path = join(fx.wt, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const files = (sha: string): string[] =>
  git(fx.wt, "ls-tree", "-r", "--name-only", sha).split("\n");

beforeEach(() => {
  fx = makeRepoFixture("friday-excl-");
});

afterEach(() => {
  // temp dirs are left to the OS, as in the sibling tests
});

describe("git exclusion of the orchestrator commit", () => {
  it("leaves .gitattributes and .gitmodules out of the commit", async () => {
    put("a.txt", "new\n");
    put(".gitattributes", "* filter=x\n");
    put("sub/.gitmodules", "[submodule]\n");
    put("sub/dir/.GitAttributes", "* text\n");
    const { sha } = await push();
    const tree = files(sha);
    expect(tree).not.toContain(".gitattributes");
    expect(tree).not.toContain("sub/.gitmodules");
    expect(tree).not.toContain("sub/dir/.GitAttributes");
    expect(git(fx.wt, "show", `${sha}:a.txt`)).toBe("new");
  });

  it("keeps .gitignore, .gitkeep and .github in the commit", async () => {
    put(".gitignore", "x\n");
    put("sub/.gitignore", "y\n");
    put(".gitkeep", "");
    put(".github/workflows/x.yml", "on: push\n");
    const { sha } = await push();
    expect(files(sha)).toEqual(
      expect.arrayContaining([
        ".gitignore",
        "sub/.gitignore",
        ".gitkeep",
        ".github/workflows/x.yml",
      ]),
    );
  });

  it("does not create a commit when only excluded files changed", async () => {
    const before = git(fx.wt, "rev-parse", "HEAD");
    put(".gitattributes", "* text\n");
    const { sha } = await push();
    expect(sha).toBe(before);
    expect(git(fx.remote, "rev-parse", "refs/heads/friday/345-x")).toBe(before);
  });

  it("does not stage changes to an already tracked .gitattributes", async () => {
    put(".gitattributes", "v1\n");
    git(fx.wt, "add", "-A");
    git(fx.wt, "commit", "-q", "-m", "attrs");
    put(".gitattributes", "v2\n");
    put("a.txt", "new\n");
    const { sha } = await push();
    expect(git(fx.wt, "show", `${sha}:.gitattributes`)).toBe("v1");
  });

  it("exports the fixed exclusion list", () => {
    expect(GIT_EXCLUDED_PATHS).toEqual([".gitattributes", ".gitmodules"]);
  });
});
