import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitCliHost } from "../src/index.ts";
import { git, makeRepoFixture, markerScript, type RepoFixture } from "./git-cli-host-fixture.ts";

let fx: RepoFixture;
let marker: string;
let nestedHead: string;

beforeEach(() => {
  fx = makeRepoFixture("git-cli-nested-");
  marker = join(fx.dir, "marker.txt");
  const script = join(fx.dir, "evil.sh");
  markerScript(script, `echo ran >> ${marker}`);
  const nested = join(fx.wt, "nested");
  mkdirSync(nested);
  git(nested, "init", "-q");
  writeFileSync(join(nested, "n.txt"), "n\n");
  writeFileSync(join(nested, ".gitattributes"), "* filter=evil\n");
  git(nested, "add", "-A");
  git(nested, "commit", "-q", "-m", "nested");
  nestedHead = git(nested, "rev-parse", "HEAD");
  git(nested, "config", "filter.evil.clean", script);
  git(nested, "config", "core.fsmonitor", script);
  for (const name of ["pre-commit", "post-commit", "post-checkout"]) {
    markerScript(join(nested, ".git", "hooks", name), `echo ${name} >> ${marker}`);
  }
  writeFileSync(join(nested, "n.txt"), "changed\n");
  writeFileSync(join(fx.wt, "a.txt"), "changed\n");
});
afterEach(() => rmSync(fx.dir, { recursive: true, force: true }));

async function push(): Promise<string> {
  const h = new GitCliHost({
    tokenEnv: "FRIDAY_AUTHOR_TOKEN",
    repoDir: fx.repoDir,
    mirrorDir: fx.mirror,
    targetUrl: fx.targetUrl,
    env: { ...process.env, FRIDAY_AUTHOR_TOKEN: "ghs_marker_token" },
  });
  return (await h.push({ worktree: fx.wt, branch: "friday/345-x", message: "feat: x" })).sha;
}

describe("GitCliHost nested repository", () => {
  it("runs no filter, hook or fsmonitor of a nested repository", async () => {
    const sha = await push();
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(marker)).toBe(false);
  });

  it("records the nested repository as a gitlink and leaves it untouched", async () => {
    const sha = await push();
    expect(git(fx.wt, "ls-tree", sha, "nested")).toMatch(/^160000 /);
    expect(git(join(fx.wt, "nested"), "rev-parse", "HEAD")).toBe(nestedHead);
  });
});
