import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GitCliHost } from "../src/index.ts";
import { configHooksSupported, requireConfigHooks } from "./config-hooks-support.ts";
import { git, makeRepoFixture, type RepoFixture } from "./git-cli-host-fixture.ts";

const posix = (p: string): string => p.split("\\").join("/");
const NOT_ALLOWED = "A config do espelho tem chaves não permitidas:";

let fx: RepoFixture;
let gitDir: string;
let sha: string;

beforeEach(() => {
  fx = makeRepoFixture("friday-mirror-guard-");
  writeFileSync(join(fx.wt, "change.txt"), "change\n");
  gitDir = realpathSync(git(fx.wt, "rev-parse", "--absolute-git-dir"));
  sha = git(fx.wt, "rev-parse", "HEAD");
});

const marker = (name: string): string => join(fx.dir, `${name}.marker`);
const touch = (name: string): string => `touch "${posix(marker(name))}"; :`;

/** A `HOME` directory whose `.gitconfig` holds `entries`. */
function homeWith(entries: [string, string][]): string {
  const home = mkdtempSync(join(tmpdir(), "friday-home-"));
  for (const [key, value] of entries) {
    git(home, "config", "--file", join(home, ".gitconfig"), key, value);
  }
  return home;
}

/** Plain git, with `home` as the only configuration source (no hardening). */
function plain(home: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: fx.dir,
    env: { PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: "1" },
    encoding: "utf8",
    stdio: "pipe",
  });
}

function host(home?: string): GitCliHost {
  return new GitCliHost({
    tokenEnv: "FRIDAY_AUTHOR_TOKEN",
    mirrorDir: fx.mirror,
    targetUrl: fx.targetUrl,
    env: {
      FRIDAY_AUTHOR_TOKEN: "ghs_marker_token",
      PATH: process.env.PATH,
      ...(home === undefined ? {} : { HOME: home, USERPROFILE: home }),
    },
  });
}

const request = (branch = "friday/345-x") => ({
  worktree: fx.wt,
  branch,
  message: "feat: muda (#345)",
});

const remoteBranches = (): string => git(fx.remote, "branch", "--list", "friday/*");

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("o push deveria ter falhado");
}

describe("GitCliHost mirror guards", { timeout: 60_000 }, () => {
  it("push refuses config hooks in the mirror config and runs none", async (ctx) => {
    git(fx.dir, "init", "--bare", "-q", fx.mirror);
    const set = (key: string, value: string): string =>
      git(fx.dir, "--git-dir", fx.mirror, "config", key, value);
    set("hook.rt.event", "reference-transaction");
    set("hook.rt.command", touch("rt"));
    set("hook.pp.event", "pre-push");
    set("hook.pp.command", touch("pp"));

    const message = await rejection(host().push(request()));
    expect(message.startsWith(NOT_ALLOWED)).toBe(true);
    expect(message).toContain("hook.rt.event");
    expect(message).toContain("hook.pp.event");
    expect(existsSync(marker("rt"))).toBe(false);
    expect(existsSync(marker("pp"))).toBe(false);
    expect(remoteBranches()).toBe("");

    requireConfigHooks(configHooksSupported("reference-transaction", "probe"), () => ctx.skip());
    git(fx.dir, "--git-dir", fx.mirror, "fetch", "--no-tags", gitDir, sha);
    expect(existsSync(marker("rt"))).toBe(true);
    git(fx.dir, "--git-dir", fx.mirror, "push", fx.targetUrl, `${sha}:refs/heads/ctl`);
    expect(existsSync(marker("pp"))).toBe(true);
  });

  it("push runs no reference-transaction hook from the HOME config", async (ctx) => {
    requireConfigHooks(configHooksSupported("reference-transaction", "probe"), () => ctx.skip());
    const entries: [string, string][] = [
      ["hook.rt.event", "reference-transaction"],
      ["hook.rt.command", touch("rt")],
    ];
    const home = homeWith(entries);
    const pushed = await host(home).push(request());
    expect(pushed.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(remoteBranches()).toContain("friday/345-x");
    expect(existsSync(marker("rt"))).toBe(false);

    const control = join(fx.dir, "control.git");
    git(fx.dir, "init", "--bare", "-q", control);
    plain(home, "--git-dir", control, "fetch", "--no-tags", gitDir, sha);
    expect(existsSync(marker("rt"))).toBe(true);
  });

  it("push refuses a mirror config with keys outside the allow-list", async (ctx) => {
    git(fx.dir, "init", "--bare", "-q", fx.mirror);
    const key = `remote.${posix(gitDir)}.uploadpack`;
    git(
      fx.dir,
      "--git-dir",
      fx.mirror,
      "config",
      key,
      `touch "${posix(marker("up"))}"; git-upload-pack`,
    );

    const message = await rejection(host().push(request()));
    expect(message.startsWith(NOT_ALLOWED)).toBe(true);
    expect(message).toContain("uploadpack");
    expect(remoteBranches()).toBe("");
    expect(existsSync(marker("up"))).toBe(false);

    // Positive check: a plain fetch runs the upload-pack of the config. Some git versions ignore a
    // remote whose name starts with "/" (a POSIX path), so the key is then not executable.
    git(fx.dir, "--git-dir", fx.mirror, "fetch", "--no-tags", gitDir, sha);
    if (!existsSync(marker("up"))) ctx.skip();
  });

  it("push ignores remote uploadpack of the HOME config", async (ctx) => {
    const key = `remote.${posix(gitDir)}.uploadpack`;
    const home = homeWith([[key, `touch "${posix(marker("up"))}"; git-upload-pack`]]);
    // Positive check first: a plain fetch with the same HOME runs the upload-pack (when this git honors the key).
    const control = join(fx.dir, "control.git");
    git(fx.dir, "init", "--bare", "-q", control);
    plain(home, "--git-dir", control, "fetch", "--no-tags", gitDir, sha);
    if (!existsSync(marker("up"))) ctx.skip();
    rmSync(marker("up"));

    const pushed = await host(home).push(request());
    expect(pushed.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(remoteBranches()).toContain("friday/345-x");
    expect(existsSync(marker("up"))).toBe(false);
  });
});
