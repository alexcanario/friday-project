import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitCliHost } from "../src/index.ts";
import { git, makeRepoFixture } from "./git-cli-host-fixture.ts";

const TOKEN = "ghs_marker_token";
const B64 = Buffer.from("x-access-token:ghs_marker_token").toString("base64");
const HEADER = "Authorization: basic " + B64;
const SHA = "a".repeat(40);
const BASE_ENV = { ...process.env, FRIDAY_AUTHOR_TOKEN: TOKEN };
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

function edit(name: string, content = name): void {
  writeFileSync(join(wt, `${name}.txt`), content);
}

type FakeMode = "ok" | "push-fails" | "fetch-fails" | "commit-fails" | "filters" | "no-changes";

function fakeGit(mode: FakeMode = "ok"): { bin: string; log: string } {
  const log = join(dir, "calls.jsonl");
  const bin = join(dir, "fake-git.mjs");
  writeFileSync(
    bin,
    `#!${process.execPath}
import { appendFileSync, mkdirSync } from "node:fs";
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, cwd: process.cwd(), env: process.env }) + "\\n");
if (argv[0] === "init") mkdirSync(argv[3], { recursive: true });
const mode = ${JSON.stringify(mode)};
const sub = argv.find((a) => ["config", "add", "diff-index", "commit", "rev-parse", "fetch", "push"].includes(a));
if (sub === "config") {
  if (mode === "filters") process.stdout.write("filter.evil.clean x\\nfilter.evil.process y\\n");
  else process.exit(1);
}
if (sub === "diff-index") process.exit(mode === "no-changes" ? 0 : 1);
if (sub === "commit" && mode === "commit-fails") {
  process.stderr.write("boom ${TOKEN}\\n");
  process.exit(1);
}
if (sub === "rev-parse") process.stdout.write(${JSON.stringify(SHA)} + "\\n");
if (mode === "push-fails" && sub === "push") {
  process.stderr.write("denied ${TOKEN} ${HEADER}\\n");
  process.exit(1);
}
if (mode === "fetch-fails" && sub === "fetch") {
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
  ({ dir, remote, wt, mirror, targetUrl } = makeRepoFixture("git-cli-host-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const REQ = { worktree: "", branch: "friday/345-x", message: "feat: x" };
const IDENTITY = "friday-author|friday-author@users.noreply.github.com";

function configPairs(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < Number(env.GIT_CONFIG_COUNT ?? 0); i++) {
    out[env[`GIT_CONFIG_KEY_${i}`] ?? ""] = env[`GIT_CONFIG_VALUE_${i}`] ?? "";
  }
  return out;
}

describe("GitCliHost", () => {
  it("commits the changed worktree and pushes that commit", async () => {
    edit("c1");
    const { sha } = await host().push({ ...REQ, worktree: wt });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(wt, "rev-parse", "HEAD")).toBe(sha);
    expect(git(remote, "rev-parse", "refs/heads/friday/345-x")).toBe(sha);
    expect(git(wt, "log", "-1", "--format=%s")).toBe("feat: x");
    expect(git(wt, "show", `${sha}:c1.txt`)).toBe("c1");
  });

  it("commits with the fixed friday-author identity", async () => {
    git(wt, "config", "user.name", "other");
    git(wt, "config", "user.email", "other@example.com");
    edit("c1");
    const { sha } = await host().push({ ...REQ, worktree: wt });
    const who = git(wt, "show", "-s", "--format=%an|%ae|%cn|%ce", sha);
    expect(who).toBe(`${IDENTITY}|${IDENTITY}`);
  });

  it("pushes HEAD again without creating a commit when nothing changed", async () => {
    edit("c1");
    const h = host();
    const first = await h.push({ ...REQ, worktree: wt });
    const count = git(wt, "rev-list", "--count", "HEAD");
    const second = await h.push({ ...REQ, worktree: wt });
    expect(second.sha).toBe(first.sha);
    expect(git(wt, "rev-list", "--count", "HEAD")).toBe(count);
    expect(git(remote, "rev-parse", "refs/heads/friday/345-x")).toBe(first.sha);
  });

  it("rejects a push that is not a fast-forward", async () => {
    edit("c1");
    const h = host();
    const { sha } = await h.push({ ...REQ, worktree: wt });
    git(wt, "checkout", "-q", "--orphan", "o");
    edit("c2");
    await expect(h.push({ ...REQ, worktree: wt })).rejects.toThrow(/^Falha no git push: /);
    expect(git(remote, "rev-parse", "refs/heads/friday/345-x")).toBe(sha);
  });

  it("runs config, add, diff-index, commit, rev-parse, fetch, push in order with the expected cwd and env", async () => {
    mkdirSync(mirror);
    writeFileSync(join(mirror, "HEAD"), "ref: refs/heads/main\n");
    const { bin, log } = fakeGit();
    const res = await host({ gitBinary: bin }).push({ ...REQ, worktree: wt });
    expect(res).toEqual({ sha: SHA });
    const all = calls(log);
    expect(all.map((c) => c.argv)).toEqual([
      ["config", "--get-regexp", "^filter\\."],
      ["add", "-A"],
      ["diff-index", "--cached", "--quiet", "HEAD"],
      [
        ...[
          "-c",
          "user.name=friday-author",
          "-c",
          "user.email=friday-author@users.noreply.github.com",
        ],
        ...[
          "-c",
          "author.name=friday-author",
          "-c",
          "author.email=friday-author@users.noreply.github.com",
        ],
        ...["-c", "committer.name=friday-author"],
        ...["-c", "committer.email=friday-author@users.noreply.github.com"],
        ...["commit", "--no-verify", "-m", "feat: x"],
      ],
      ["rev-parse", "HEAD"],
      ["--git-dir", mirror, "fetch", "--no-tags", "--quiet", wt, SHA],
      ["--git-dir", mirror, "push", "--no-verify", targetUrl, `${SHA}:refs/heads/friday/345-x`],
    ]);
    expect(all.map((c) => c.cwd)).toEqual([wt, wt, wt, wt, wt, mirror, mirror]);
    for (const c of all.slice(0, 5)) {
      expect(c.env.GIT_WORK_TREE).toBe(wt);
      expect(c.env.GIT_CONFIG_NOSYSTEM).toBe("1");
      expect(c.env.GIT_ATTR_NOSYSTEM).toBe("1");
      expect(c.env.GIT_TERMINAL_PROMPT).toBe("0");
      expect("FRIDAY_AUTHOR_TOKEN" in c.env).toBe(false);
      expect(c.env.HOME).toBe(c.env.USERPROFILE);
      expect(c.env.HOME).not.toBe(process.env.HOME);
      expect(configPairs(c.env)).toMatchObject({
        "core.hooksPath": "/dev/null",
        "core.fsmonitor": "false",
        "commit.gpgSign": "false",
        "core.attributesFile": "",
        "gc.auto": "0",
        "maintenance.auto": "false",
      });
    }
    const fetchEnv = all[5]?.env ?? {};
    expect(fetchEnv.GIT_CONFIG_COUNT).toBe("1");
    expect(fetchEnv.GIT_CONFIG_KEY_0).toBe("core.hooksPath");
    expect(all[6]?.env.GIT_CONFIG_VALUE_0).toBe(HEADER);
  });

  it("neutralizes every filter driver reported by the worktree config", async () => {
    const { bin, log } = fakeGit("filters");
    await host({ gitBinary: bin }).push({ ...REQ, worktree: wt });
    const [first, add] = calls(log);
    expect(configPairs(first?.env ?? {})).not.toHaveProperty("filter.evil.clean");
    expect(configPairs(add?.env ?? {})).toMatchObject({
      "filter.evil.clean": "",
      "filter.evil.process": "",
      "filter.evil.required": "false",
    });
  });

  it("skips the commit when the index has no changes and pushes the current HEAD", async () => {
    const { bin, log } = fakeGit("no-changes");
    const res = await host({ gitBinary: bin }).push({ ...REQ, worktree: wt });
    expect(res.sha).toBe(SHA);
    const subs = calls(log).map((c) => c.argv.find((a) => a === "commit"));
    expect(subs).not.toContain("commit");
  });

  it("removes the temporary HOME on success and on failure", async () => {
    const ok = fakeGit();
    await host({ gitBinary: ok.bin }).push({ ...REQ, worktree: wt });
    const home = calls(ok.log)[0]?.env.HOME ?? "";
    expect(home).not.toBe("");
    expect(existsSync(home)).toBe(false);
    rmSync(ok.log);
    const bad = fakeGit("commit-fails");
    await expect(host({ gitBinary: bad.bin }).push({ ...REQ, worktree: wt })).rejects.toThrow(
      /^Falha ao criar o commit: /,
    );
    const failedHome = calls(bad.log)[0]?.env.HOME ?? "";
    expect(failedHome).not.toBe("");
    expect(existsSync(failedHome)).toBe(false);
  });

  it("fetches without token and pushes from the mirror", async () => {
    mkdirSync(mirror);
    writeFileSync(join(mirror, "HEAD"), "ref: refs/heads/main\n");
    const { bin, log } = fakeGit();
    await host({ gitBinary: bin }).push({ ...REQ, worktree: wt });
    const all = calls(log);
    expect(all).toHaveLength(7);
    expect(all[5]?.env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(all[6]?.env.GIT_CONFIG_COUNT).toBe("2");
    expect(all[6]?.env.GIT_CONFIG_KEY_1).toBe("core.hooksPath");
  });

  it("initializes a missing mirror", async () => {
    const { bin, log } = fakeGit();
    await host({ gitBinary: bin }).push({ ...REQ, worktree: wt });
    const all = calls(log);
    expect(all).toHaveLength(8);
    expect(all[5]?.argv).toEqual(["init", "--bare", "--quiet", mirror]);
  });

  it("fails without running git when the token variable is missing", async () => {
    const { bin, log } = fakeGit();
    const msg = "A variável de ambiente FRIDAY_AUTHOR_TOKEN não está definida.";
    const req = { ...REQ, worktree: wt };
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

  it("rejects an invalid message, branch or worktree before running git", async () => {
    const { bin, log } = fakeGit();
    const h = host({ gitBinary: bin });
    const ok = { ...REQ, worktree: wt };
    const link = join(dir, "link");
    symlinkSync(dir, link);
    const bad = [
      ...[
        "develop",
        "main",
        "--force",
        "HEAD",
        "friday/152-X",
        "friday/x",
        "feature/152-x",
        "",
      ].map((branch) => ({ ...ok, branch })),
      ...["", "   "].map((message) => ({ ...ok, message })),
      { ...ok, commit: SHA },
      ...["", "relative/wt", "-x", mirror, dir, link].map((worktree) => ({ ...ok, worktree })),
    ];
    for (const req of bad) await expect(h.push(req)).rejects.toThrow(Error);
    expect(existsSync(log)).toBe(false);
  });

  it("redacts the token from the fetch and push errors", async () => {
    mkdirSync(mirror);
    writeFileSync(join(mirror, "HEAD"), "ref: refs/heads/main\n");
    const req = { ...REQ, worktree: wt };
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
    expect(calls(fetchFail.log)).toHaveLength(6);
  });

  it("ignores the malicious config and hooks of the worktree", async () => {
    edit("C1");
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
    const cfg = join(git(wt, "rev-parse", "--path-format=absolute", "--git-common-dir"), "config");
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
    const { sha } = await host().push({ ...REQ, worktree: wt });
    expect(git(remote, "rev-parse", "refs/heads/friday/345-x")).toBe(sha);
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
