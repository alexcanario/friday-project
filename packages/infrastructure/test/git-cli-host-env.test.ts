import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitCliHost } from "../src/index.ts";

const TOKEN = "ghs_marker_token";
const B64 = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
const SHA = "a".repeat(40);
const IDENT = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const ALLOWED = /^(PATH|HOME|USERPROFILE|SYSTEMROOT|TEMP|TMP|LANG|GIT_TERMINAL_PROMPT|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_[0-9]+|GIT_CONFIG_VALUE_[0-9]+)$/;

interface Call {
  argv: string[];
  env: Record<string, string>;
}

let dir: string;
let remote: string;
let wt: string;
let mirror: string;
let targetUrl: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: { ...process.env, ...IDENT },
    encoding: "utf8",
  }).trim();
}

function commitFile(name: string): string {
  writeFileSync(join(wt, `${name}.txt`), name);
  git(wt, "add", "-A");
  git(wt, "commit", "-q", "-m", name);
  return git(wt, "rev-parse", "HEAD");
}

function fakeGit(): { bin: string; log: string } {
  const log = join(dir, "calls.jsonl");
  const bin = join(dir, "fake-git.mjs");
  writeFileSync(
    bin,
    `#!${process.execPath}
import { appendFileSync, mkdirSync } from "node:fs";
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, env: process.env }) + "\\n");
if (argv[0] === "init") mkdirSync(argv[3], { recursive: true });
`,
  );
  chmodSync(bin, 0o755);
  return { bin, log };
}

function calls(log: string): Call[] {
  return readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Call);
}

function host(env: Record<string, string | undefined>, gitBinary?: string): GitCliHost {
  return new GitCliHost({
    tokenEnv: "FRIDAY_AUTHOR_TOKEN",
    mirrorDir: mirror,
    targetUrl,
    env,
    ...(gitBinary === undefined ? {} : { gitBinary }),
  });
}

async function runFake(env: Record<string, string>): Promise<[Call, Call]> {
  mkdirSync(mirror);
  writeFileSync(join(mirror, "HEAD"), "ref: refs/heads/main\n");
  const { bin, log } = fakeGit();
  await host(env, bin).push({ worktree: wt, branch: "friday/182-x", commit: SHA });
  const [fetchCall, pushCall] = calls(log);
  if (fetchCall === undefined || pushCall === undefined) throw new Error("expected two calls");
  return [fetchCall, pushCall];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "git-cli-host-env-"));
  remote = join(dir, "remote.git");
  wt = join(dir, "wt");
  mirror = join(dir, "mirror");
  targetUrl = `file://${remote}`;
  git(dir, "init", "--bare", "-q", remote);
  git(dir, "init", "-q", wt);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("GitCliHost environment allowlist", () => {
  it("passes only allowlisted variables to fetch and push", async () => {
    const env = {
      PATH: process.env.PATH ?? "/usr/bin",
      HOME: "/home/x",
      LANG: "C",
      FRIDAY_AUTHOR_TOKEN: TOKEN,
      FOO_SECRET: "x",
      GIT_COMMON_DIR: "/c",
      GIT_OBJECT_DIRECTORY: "/o",
      GIT_ALTERNATE_OBJECT_DIRECTORIES: "/a",
      GIT_NAMESPACE: "evil",
      GIT_INDEX_FILE: "/i",
      GIT_AUTHOR_NAME: "n",
      GIT_EXEC_PATH: "/e",
    };
    for (const call of await runFake(env)) {
      for (const key of [
        "FRIDAY_AUTHOR_TOKEN",
        "FOO_SECRET",
        "GIT_COMMON_DIR",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_NAMESPACE",
        "GIT_INDEX_FILE",
        "GIT_AUTHOR_NAME",
        "GIT_EXEC_PATH",
      ]) {
        expect(call.env).not.toHaveProperty(key);
      }
      expect(call.env.PATH).toBe(env.PATH);
      expect(call.env.HOME).toBe("/home/x");
      expect(call.env.LANG).toBe("C");
    }
  });

  it("sets only the host-defined git variables", async () => {
    const env = { PATH: "/usr/bin", FOO: "1", GIT_DIR: "/d", FRIDAY_AUTHOR_TOKEN: TOKEN };
    const [fetchCall, pushCall] = await runFake(env);
    for (const call of [fetchCall, pushCall]) {
      for (const key of Object.keys(call.env)) expect(key).toMatch(ALLOWED);
      expect(call.env.GIT_TERMINAL_PROMPT).toBe("0");
    }
    expect(fetchCall.env.GIT_CONFIG_COUNT).toBe("1");
    expect(pushCall.env.GIT_CONFIG_COUNT).toBe("2");
    expect(pushCall.env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
  });

  it("matches allowlist keys case-insensitively and drops the rest", async () => {
    const env = { Path: "/x", FRIDAY_AUTHOR_TOKEN: TOKEN, GIT_DIR: "/d", TMPDIR: "/t" };
    for (const call of await runFake(env)) {
      expect(call.env.Path).toBe("/x");
      expect(call.env).not.toHaveProperty("GIT_DIR");
      expect(call.env).not.toHaveProperty("TMPDIR");
    }
  });

  it("keeps the token out of the fetch step", async () => {
    const [fetchCall, pushCall] = await runFake({
      PATH: "/usr/bin",
      FRIDAY_AUTHOR_TOKEN: TOKEN,
    });
    const fetchText = JSON.stringify(fetchCall);
    expect(fetchText).not.toContain(TOKEN);
    expect(fetchText).not.toContain(B64);
    expect(pushCall.argv.join(" ")).not.toContain(B64);
    expect(pushCall.env.GIT_CONFIG_VALUE_0).toContain(B64);
    for (const [key, value] of Object.entries(pushCall.env)) {
      if (key !== "GIT_CONFIG_VALUE_0") expect(value).not.toContain(B64);
    }
  });
});

describe("GitCliHost with a malicious worktree", () => {
  it("ignores inherited GIT_COMMON_DIR and object directory variables", async () => {
    const c1 = commitFile("C1");
    const evil = join(dir, "evil-remote.git");
    git(dir, "init", "--bare", "-q", evil);
    git(wt, "config", `url.${evil}.insteadOf`, targetUrl);
    const env = {
      ...process.env,
      FRIDAY_AUTHOR_TOKEN: TOKEN,
      GIT_COMMON_DIR: join(wt, ".git"),
      GIT_OBJECT_DIRECTORY: join(wt, ".git", "objects"),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: join(dir, "alt"),
      GIT_NAMESPACE: "evil",
      GIT_INDEX_FILE: join(wt, ".git", "index"),
    };
    await host(env).push({ worktree: wt, branch: "friday/182-x", commit: c1 });
    expect(git(remote, "rev-parse", "refs/heads/friday/182-x")).toBe(c1);
    const list = git(dir, "--git-dir", mirror, "config", "--list");
    expect(list).not.toContain(TOKEN);
    expect(list).not.toContain(B64);
    expect(list).not.toContain("insteadof");
    expect(git(remote, "for-each-ref", "refs/namespaces")).toBe("");
    expect(git(evil, "for-each-ref")).toBe("");
  });

  it("runs no agent command when fetching from a malicious worktree", async () => {
    const c1 = commitFile("C1");
    const marker = join(dir, "marker");
    const script = join(dir, "evil.sh");
    writeFileSync(script, `#!/bin/sh\necho ran >> ${marker}\n`);
    chmodSync(script, 0o755);
    const hooksDir = join(dir, "evil-hooks");
    mkdirSync(hooksDir);
    for (const name of ["pre-push", "reference-transaction", "post-checkout", "pre-commit"]) {
      for (const base of [hooksDir, join(wt, ".git", "hooks")]) {
        writeFileSync(join(base, name), `#!/bin/sh\necho ${name} >> ${marker}\n`);
        chmodSync(join(base, name), 0o755);
      }
    }
    git(wt, "config", "core.fsmonitor", script);
    git(wt, "config", "core.sshCommand", script);
    git(wt, "config", "credential.helper", script);
    git(wt, "config", "core.hooksPath", hooksDir);
    git(wt, "config", `url.${join(dir, "evil-remote.git")}.insteadOf`, wt);
    const env = { ...process.env, FRIDAY_AUTHOR_TOKEN: TOKEN };
    await host(env).push({ worktree: wt, branch: "friday/182-x", commit: c1 });
    expect(git(remote, "rev-parse", "refs/heads/friday/182-x")).toBe(c1);
    expect(existsSync(marker)).toBe(false);
  });
});
