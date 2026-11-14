import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitCliHost } from "../src/index.ts";
import { git, makeRepoFixture } from "./git-cli-host-fixture.ts";

const TOKEN = "ghs_marker_token";
const B64 = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
const SHA = "a".repeat(40);
// On win32, libuv (Node's process spawner) re-adds these from the parent environment to every child.
const WIN_INJECTED =
  process.platform === "win32"
    ? "|HOMEDRIVE|HOMEPATH|LOGONSERVER|SYSTEMDRIVE|USERDOMAIN|USERNAME|WINDIR"
    : "";
const ALLOWED = new RegExp(
  `^(PATH|HOME|USERPROFILE|SYSTEMROOT|TEMP|TMP|LANG|GIT_TERMINAL_PROMPT|GIT_CONFIG_NOSYSTEM|GIT_ATTR_NOSYSTEM|GIT_WORK_TREE|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_[0-9]+|GIT_CONFIG_VALUE_[0-9]+${WIN_INJECTED})$`,
);

interface Call {
  argv: string[];
  env: Record<string, string>;
}

let dir: string;
let repoDir: string;
let remote: string;
let wt: string;
let mirror: string;
let targetUrl: string;

function editFile(name: string): void {
  writeFileSync(join(wt, `${name}.txt`), name);
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
if (argv[0] === "config") process.exit(1);
if (argv[0] === "diff-index") process.exit(1);
if (argv[0] === "rev-parse") process.stdout.write(${JSON.stringify(SHA)} + "\\n");
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
    repoDir,
    mirrorDir: mirror,
    targetUrl,
    env,
    ...(gitBinary === undefined ? {} : { gitBinary }),
  });
}

async function runFake(env: Record<string, string>): Promise<[Call, Call]> {
  const all = await runFakeAll(env);
  const [fetchCall, pushCall] = all.slice(-2);
  if (fetchCall === undefined || pushCall === undefined) throw new Error("expected two calls");
  return [fetchCall, pushCall];
}

async function runFakeAll(env: Record<string, string>): Promise<Call[]> {
  mkdirSync(mirror);
  writeFileSync(join(mirror, "HEAD"), "ref: refs/heads/main\n");
  const { bin, log } = fakeGit();
  await host(env, bin).push({ worktree: wt, branch: "friday/182-x", message: "feat: x" });
  return calls(log);
}

beforeEach(() => {
  ({ dir, repoDir, remote, wt, mirror, targetUrl } = makeRepoFixture("git-cli-host-env-"));
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
    if (process.platform !== "win32") expect(fetchCall.env).not.toHaveProperty("HOMEDRIVE");
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

  it("keeps the token out of the commit steps and of the errors", async () => {
    const all = await runFakeAll({ PATH: "/usr/bin", FRIDAY_AUTHOR_TOKEN: TOKEN });
    for (const c of all.slice(0, 5)) {
      const text = JSON.stringify(c);
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(B64);
      expect(text).not.toContain("Authorization");
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
    editFile("C1");
    const evil = join(dir, "evil-remote.git");
    git(dir, "init", "--bare", "-q", evil);
    git(wt, "config", `url.${evil}.insteadOf`, targetUrl);
    const env = {
      ...process.env,
      FRIDAY_AUTHOR_TOKEN: TOKEN,
      GIT_COMMON_DIR: git(wt, "rev-parse", "--path-format=absolute", "--git-common-dir"),
      GIT_OBJECT_DIRECTORY: join(
        git(wt, "rev-parse", "--path-format=absolute", "--git-common-dir"),
        "objects",
      ),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: join(dir, "alt"),
      GIT_NAMESPACE: "evil",
      GIT_INDEX_FILE: join(wt, "..", "idx"),
    };
    const { sha } = await host(env).push({
      worktree: wt,
      branch: "friday/182-x",
      message: "feat: x",
    });
    expect(git(remote, "rev-parse", "refs/heads/friday/182-x")).toBe(sha);
    const list = git(dir, "--git-dir", mirror, "config", "--local", "--list");
    expect(list).not.toContain(TOKEN);
    expect(list).not.toContain(B64);
    expect(list).not.toContain("insteadof");
    expect(git(remote, "for-each-ref", "refs/namespaces")).toBe("");
    expect(git(evil, "for-each-ref")).toBe("");
  });

  it("runs no agent command when fetching from a malicious worktree", async () => {
    editFile("C1");
    const marker = join(dir, "marker");
    const script = join(dir, "evil.sh");
    writeFileSync(script, `#!/bin/sh\necho ran >> ${marker}\n`);
    chmodSync(script, 0o755);
    const hooksDir = join(dir, "evil-hooks");
    mkdirSync(hooksDir);
    for (const name of ["pre-push", "reference-transaction", "post-checkout", "pre-commit"]) {
      for (const base of [
        hooksDir,
        join(git(wt, "rev-parse", "--path-format=absolute", "--git-common-dir"), "hooks"),
      ]) {
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
    const { sha } = await host(env).push({
      worktree: wt,
      branch: "friday/182-x",
      message: "feat: x",
    });
    expect(git(remote, "rev-parse", "refs/heads/friday/182-x")).toBe(sha);
    expect(existsSync(marker)).toBe(false);
  });

  it("rejects a tokenEnv that is in the allowlist (PATH, HOME, path)", () => {
    for (const tokenEnv of ["PATH", "HOME", "path"]) {
      expect(() => new GitCliHost({ tokenEnv, repoDir, mirrorDir: mirror, targetUrl })).toThrow(
        new Error(
          "O nome da variável de ambiente do token não pode ser uma variável da lista de permissão do ambiente do git.",
        ),
      );
    }
  });

  it("accepts a tokenEnv outside the allowlist", () => {
    expect(
      () => new GitCliHost({ tokenEnv: "GITHUB_TOKEN", repoDir, mirrorDir: mirror, targetUrl }),
    ).not.toThrow();
  });
});
