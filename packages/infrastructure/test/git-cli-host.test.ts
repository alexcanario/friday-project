import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitCliHost } from "../src/index.ts";

const TOKEN = "ghs_marker_token";
const B64 = Buffer.from("x-access-token:ghs_marker_token").toString("base64");
const HEADER = "Authorization: basic " + B64;
const SHA = "a".repeat(40);
const BASE_ENV = { ...process.env, FRIDAY_AUTHOR_TOKEN: TOKEN };
const IDENT = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

interface Call {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
}

let dir: string;
let remote: string;
let wt: string;
let mirror: string;
let targetUrl: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: { ...process.env, ...IDENT }, encoding: "utf8" }).trim();
}

function commit(msg: string, orphan = false): string {
  if (orphan) git(wt, "checkout", "--orphan", `o-${msg}`);
  writeFileSync(join(wt, `${msg}.txt`), msg);
  git(wt, "add", "-A");
  git(wt, "commit", "-q", "-m", msg);
  return git(wt, "rev-parse", "HEAD");
}

function fakeGit(mode: "ok" | "push-fails" | "fetch-fails" = "ok"): { bin: string; log: string } {
  const log = join(dir, "calls.jsonl");
  const bin = join(dir, "fake-git.mjs");
  writeFileSync(
    bin,
    `#!${process.execPath}
import { appendFileSync } from "node:fs";
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, cwd: process.cwd(), env: process.env }) + "\\n");
const mode = ${JSON.stringify(mode)};
if (mode === "push-fails" && argv.includes("push")) {
  process.stderr.write("denied ${TOKEN} ${HEADER}\\n");
  process.exit(1);
}
if (mode === "fetch-fails" && argv.includes("fetch")) {
  process.stderr.write("denied ${TOKEN}\\n");
  process.exit(1);
}
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

function host(extra: Record<string, unknown> = {}): GitCliHost {
  return new GitCliHost({
    tokenEnv: "FRIDAY_AUTHOR_TOKEN",
    mirrorDir: mirror,
    targetUrl,
    env: BASE_ENV,
    ...extra,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "git-cli-host-"));
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

describe("GitCliHost", () => {
  it("pushes the commit through the mirror to a local remote and can repeat", async () => {
    const c1 = commit("C1");
    const h = host();
    await h.push({ worktree: wt, branch: "friday/152-x", commit: c1 });
    expect(git(remote, "rev-parse", "refs/heads/friday/152-x")).toBe(c1);
    await h.push({ worktree: wt, branch: "friday/152-x", commit: c1 });
    expect(git(remote, "rev-parse", "refs/heads/friday/152-x")).toBe(c1);
  });

  it("rejects a push that is not a fast-forward", async () => {
    const c1 = commit("C1");
    const h = host();
    await h.push({ worktree: wt, branch: "friday/152-x", commit: c1 });
    const c2 = commit("C2", true);
    await expect(h.push({ worktree: wt, branch: "friday/152-x", commit: c2 })).rejects.toThrow(
      /^Falha no git push: /,
    );
    expect(git(remote, "rev-parse", "refs/heads/friday/152-x")).toBe(c1);
  });

  it("fetches without token and pushes from the mirror with the expected argv, cwd and env", async () => {
    mkdirSync(mirror);
    writeFileSync(join(mirror, "HEAD"), "ref: refs/heads/main\n");
    const { bin, log } = fakeGit();
    await host({ gitBinary: bin }).push({ worktree: wt, branch: "friday/152-x", commit: SHA });
    const [c1, c2, ...rest] = calls(log);
    expect(rest).toHaveLength(0);
    expect(c1?.argv).toEqual(["--git-dir", mirror, "fetch", "--no-tags", "--quiet", wt, SHA]);
    expect(c1?.cwd).toBe(mirror);
    expect(c1?.env.GIT_CONFIG_COUNT).toBe("1");
    expect(c1?.env.GIT_CONFIG_KEY_0).toBe("core.hooksPath");
    expect(c1?.env.GIT_CONFIG_VALUE_0).toBe("/dev/null");
    expect(c1?.env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(c2?.argv).toEqual([
      "--git-dir",
      mirror,
      "push",
      "--no-verify",
      targetUrl,
      `${SHA}:refs/heads/friday/152-x`,
    ]);
    expect(c2?.cwd).toBe(mirror);
    expect(c2?.env.GIT_CONFIG_COUNT).toBe("2");
    expect(c2?.env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    expect(c2?.env.GIT_CONFIG_VALUE_0).toBe(HEADER);
    expect(c2?.env.GIT_CONFIG_KEY_1).toBe("core.hooksPath");
    expect(c2?.env.GIT_CONFIG_VALUE_1).toBe("/dev/null");
    expect(c2?.env.GIT_TERMINAL_PROMPT).toBe("0");
  });

  it("initializes a missing mirror", async () => {
    const { bin, log } = fakeGit();
    await host({ gitBinary: bin }).push({ worktree: wt, branch: "friday/152-x", commit: SHA });
    const all = calls(log);
    expect(all).toHaveLength(3);
    expect(all[0]?.argv).toEqual(["init", "--bare", "--quiet", mirror]);
  });

  it("keeps the token out of argv, of the fetch step and of inherited git variables", async () => {
    mkdirSync(mirror);
    writeFileSync(join(mirror, "HEAD"), "ref: refs/heads/main\n");
    const { bin, log } = fakeGit();
    const env = {
      ...BASE_ENV,
      GIT_CONFIG_PARAMETERS: "'x=y'",
      GIT_ASKPASS: "/bin/x",
      GIT_CONFIG_GLOBAL: "/tmp/g",
      GIT_SSH_COMMAND: "ssh -v",
      GIT_DIR: "/tmp/d",
      GIT_TRACE: "1",
      GIT_TRACE_CURL: "1",
      GIT_CONFIG_KEY_5: "x",
    };
    await host({ gitBinary: bin, env }).push({ worktree: wt, branch: "friday/152-x", commit: SHA });
    const all = calls(log);
    expect(all).toHaveLength(2);
    for (const c of all) {
      for (const a of c.argv) {
        expect(a).not.toContain(TOKEN);
        expect(a).not.toContain(B64);
      }
      expect("FRIDAY_AUTHOR_TOKEN" in c.env).toBe(false);
      for (const k of [
        "GIT_CONFIG_PARAMETERS",
        "GIT_ASKPASS",
        "GIT_CONFIG_GLOBAL",
        "GIT_SSH_COMMAND",
        "GIT_DIR",
        "GIT_TRACE",
        "GIT_TRACE_CURL",
        "GIT_CONFIG_KEY_5",
      ]) {
        expect(k in c.env).toBe(false);
      }
    }
    const fetchText = JSON.stringify(all[0]);
    expect(fetchText).not.toContain(TOKEN);
    expect(fetchText).not.toContain(B64);
  });

  it("fails without running git when the token variable is missing", async () => {
    const { bin, log } = fakeGit();
    const msg = "A variável de ambiente FRIDAY_AUTHOR_TOKEN não está definida.";
    const req = { worktree: wt, branch: "friday/152-x", commit: SHA };
    await expect(host({ gitBinary: bin, env: {} }).push(req)).rejects.toThrow(msg);
    await expect(
      host({ gitBinary: bin, env: { FRIDAY_AUTHOR_TOKEN: "  " } }).push(req),
    ).rejects.toThrow(msg);
    expect(existsSync(log)).toBe(false);
  });

  it("rejects an invalid constructor configuration", () => {
    const base = { tokenEnv: "T", mirrorDir: mirror, targetUrl: "https://github.com/a/b.git" };
    expect(() => new GitCliHost({ ...base, tokenEnv: "  " })).toThrow(Error);
    expect(() => new GitCliHost({ ...base, mirrorDir: "relative/dir" })).toThrow(Error);
    for (const url of [
      "ssh://git@github.com/a/b.git",
      "ext::sh -c x",
      "-oProxy",
      "https://user:pw@github.com/a/b.git",
    ]) {
      expect(() => new GitCliHost({ ...base, targetUrl: url })).toThrow(Error);
    }
    expect(
      () =>
        new GitCliHost({ ...base, targetUrl: "https://github.com/alexcanario/friday-project.git" }),
    ).not.toThrow();
    expect(() => new GitCliHost({ ...base, targetUrl: "file:///tmp/r.git" })).not.toThrow();
  });

  it("rejects an invalid branch, commit or worktree before running git", async () => {
    const { bin, log } = fakeGit();
    const h = host({ gitBinary: bin });
    const ok = { worktree: wt, branch: "friday/152-x", commit: SHA };
    const link = join(dir, "link");
    symlinkSync(dir, link);
    const bad = [
      ...["develop", "main", "--force", "friday/152-X", "friday/x", "feature/152-x", ""].map(
        (branch) => ({ ...ok, branch }),
      ),
      ...["HEAD", "--force", "A".repeat(40), "a".repeat(39), ""].map((commit) => ({
        ...ok,
        commit,
      })),
      ...["", "relative/wt", "-x", mirror, dir, link].map((worktree) => ({ ...ok, worktree })),
    ];
    for (const req of bad) await expect(h.push(req)).rejects.toThrow(Error);
    expect(existsSync(log)).toBe(false);
    await expect(h.push({ ...ok, branch: "friday/152" })).resolves.toBeUndefined();
    expect(existsSync(log)).toBe(true);
  });

  it("redacts the token from the fetch and push errors", async () => {
    mkdirSync(mirror);
    writeFileSync(join(mirror, "HEAD"), "ref: refs/heads/main\n");
    const req = { worktree: wt, branch: "friday/152-x", commit: SHA };
    const pushFail = fakeGit("push-fails");
    const err = (await host({ gitBinary: pushFail.bin })
      .push(req)
      .catch((e: unknown) => e)) as Error;
    expect(err.message.startsWith("Falha no git push: ")).toBe(true);
    expect(err.message).toContain("***");
    for (const text of [err.message, String(err.cause ?? "")]) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(B64);
    }
    rmSync(pushFail.log);
    const fetchFail = fakeGit("fetch-fails");
    const err2 = (await host({ gitBinary: fetchFail.bin })
      .push(req)
      .catch((e: unknown) => e)) as Error;
    expect(err2.message.startsWith("Falha ao buscar o commit no espelho: ")).toBe(true);
    expect(err2.message).not.toContain(TOKEN);
    expect(calls(fetchFail.log)).toHaveLength(1);
  });

  it("rejects a commit that does not exist in the worktree", async () => {
    commit("C1");
    await expect(
      host().push({ worktree: wt, branch: "friday/152-y", commit: "b".repeat(40) }),
    ).rejects.toThrow(/^Falha ao buscar o commit no espelho: /);
    expect(() => git(remote, "rev-parse", "--verify", "refs/heads/friday/152-y")).toThrow();
  });

  it("ignores the malicious config and hooks of the worktree", async () => {
    const c1 = commit("C1");
    const marker = join(dir, "marker.txt");
    const script = join(dir, "evil.sh");
    writeFileSync(script, `#!/bin/sh\nenv >> ${marker}\n`);
    chmodSync(script, 0o755);
    const hooks = join(dir, "hooks");
    mkdirSync(hooks);
    for (const name of ["pre-push", "reference-transaction"]) {
      writeFileSync(join(hooks, name), `#!/bin/sh\necho ${name} >> ${marker}\n`);
      chmodSync(join(hooks, name), 0o755);
    }
    const cfg = join(wt, ".git", "config");
    const set = (k: string, v: string): void => {
      execFileSync("git", ["config", "--file", cfg, k, v]);
    };
    for (const k of [
      "core.sshCommand",
      "remote.origin.receivepack",
      "remote.origin.uploadpack",
      "credential.helper",
      "http.proxy",
    ]) {
      set(k, script);
    }
    set("core.hooksPath", hooks);
    await host().push({ worktree: wt, branch: "friday/152-z", commit: c1 });
    expect(git(remote, "rev-parse", "refs/heads/friday/152-z")).toBe(c1);
    expect(existsSync(marker)).toBe(false);
    const list = git(dir, "--git-dir", mirror, "config", "--list");
    expect(list).not.toContain(TOKEN);
    expect(list).not.toContain(B64);
  });

  it("is exported and adds no dependency", () => {
    expect(typeof GitCliHost).toBe("function");
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.execa).toBe("10.2.1");
    expect(Object.keys(pkg.dependencies)).toHaveLength(10);
    const src = readFileSync(join(import.meta.dirname, "../src/git-cli-host.ts"), "utf8");
    expect(src.match(/process\.env/g)).toHaveLength(1);
    expect(src).toMatch(/env\s*=\s*process\.env/);
  });
});
