import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GitCliHost } from "../src/index.ts";

const TOKEN = "ghs_marker_token";
const B64 = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
const HEADER = `Authorization: basic ${B64}`;
const SHA = "a".repeat(40);
const env = { ...process.env, FRIDAY_AUTHOR_TOKEN: TOKEN };
const IDENT = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

const tmp = () => mkdtempSync(join(tmpdir(), "git-cli-host-"));
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env: { ...process.env, ...IDENT }, encoding: "utf8" }).trim();

function repo() {
  const root = tmp();
  const remote = join(root, "remote.git");
  const wt = join(root, "wt");
  mkdirSync(remote);
  git(remote, "init", "--bare", "-q");
  mkdirSync(wt);
  git(wt, "init", "-q");
  git(wt, "remote", "add", "origin", `file://${remote}`);
  const commit = (msg: string) => {
    writeFileSync(join(wt, "f.txt"), msg);
    git(wt, "add", ".");
    git(wt, "commit", "-q", "-m", msg);
    return git(wt, "rev-parse", "HEAD");
  };
  const ref = (name: string) => {
    try {
      return git(remote, "rev-parse", "--verify", "-q", name);
    } catch {
      return "";
    }
  };
  return { root, remote, wt, commit, ref };
}

function fakeGit(failing = false) {
  const dir = tmp();
  const bin = join(dir, "git");
  const out = join(dir, "record.json");
  const body = failing
    ? `process.stderr.write(${JSON.stringify(TOKEN + " " + HEADER + " " + B64)});process.exit(1);`
    : `require("node:fs").writeFileSync(${JSON.stringify(out)},JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),env:process.env}));`;
  writeFileSync(bin, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(bin, 0o755);
  const record = () =>
    JSON.parse(readFileSync(out, "utf8")) as {
      argv: string[];
      cwd: string;
      env: Record<string, string>;
    };
  return { bin, out, record, dir };
}

describe("GitCliHost", () => {
  it("pushes the commit to the branch of a local remote and can repeat", async () => {
    const r = repo();
    const c1 = r.commit("c1");
    const host = new GitCliHost({ tokenEnv: "FRIDAY_AUTHOR_TOKEN", env });
    const req = { worktree: r.wt, branch: "friday/152-x", commit: c1 };
    await expect(host.push(req)).resolves.toBeUndefined();
    expect(r.ref("refs/heads/friday/152-x")).toBe(c1);
    await expect(host.push(req)).resolves.toBeUndefined();
    expect(r.ref("refs/heads/friday/152-x")).toBe(c1);
  });

  it("rejects a push that is not a fast-forward", async () => {
    const r = repo();
    const c1 = r.commit("c1");
    const host = new GitCliHost({ tokenEnv: "FRIDAY_AUTHOR_TOKEN", env });
    await host.push({ worktree: r.wt, branch: "friday/152-x", commit: c1 });
    git(r.wt, "checkout", "-q", "--orphan", "other");
    const c2 = r.commit("c2");
    await expect(host.push({ worktree: r.wt, branch: "friday/152-x", commit: c2 })).rejects.toThrow(
      /^Falha no git push: /,
    );
    expect(r.ref("refs/heads/friday/152-x")).toBe(c1);
  });

  it("runs git push with the expected argv, cwd and token env", async () => {
    const f = fakeGit();
    const wt = tmp();
    const host = new GitCliHost({ tokenEnv: "FRIDAY_AUTHOR_TOKEN", env, gitBinary: f.bin });
    await host.push({ worktree: wt, branch: "friday/152-x", commit: SHA });
    const rec = f.record();
    expect(rec.argv).toEqual(["push", "--no-verify", "origin", `${SHA}:refs/heads/friday/152-x`]);
    expect(rec.cwd).toBe(wt);
    expect(rec.env.GIT_CONFIG_COUNT).toBe("2");
    expect(rec.env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    expect(rec.env.GIT_CONFIG_VALUE_0).toBe(HEADER);
    expect(rec.env.GIT_CONFIG_KEY_1).toBe("core.hooksPath");
    expect(rec.env.GIT_CONFIG_VALUE_1).toBe("/dev/null");
    expect(rec.env.GIT_TERMINAL_PROMPT).toBe("0");
    const up = new GitCliHost({
      tokenEnv: "FRIDAY_AUTHOR_TOKEN",
      env,
      gitBinary: f.bin,
      remote: "upstream",
    });
    await up.push({ worktree: wt, branch: "friday/152-x", commit: SHA });
    expect(f.record().argv[2]).toBe("upstream");
  });

  it("keeps the token out of argv and of the token variable", async () => {
    const f = fakeGit();
    const host = new GitCliHost({
      tokenEnv: "FRIDAY_AUTHOR_TOKEN",
      env: { ...env, GIT_CONFIG_PARAMETERS: "x", GIT_ASKPASS: "y", GIT_CONFIG_GLOBAL: "z" },
      gitBinary: f.bin,
    });
    await host.push({ worktree: tmp(), branch: "friday/152-x", commit: SHA });
    const rec = f.record();
    for (const a of rec.argv) {
      expect(a).not.toContain(TOKEN);
      expect(a).not.toContain(B64);
    }
    expect("FRIDAY_AUTHOR_TOKEN" in rec.env).toBe(false);
    for (const k of ["GIT_CONFIG_PARAMETERS", "GIT_ASKPASS", "GIT_CONFIG_GLOBAL"]) {
      expect(k in rec.env).toBe(false);
    }
  });

  it("fails without running git when the token variable is missing", async () => {
    for (const e of [{ ...process.env }, { ...process.env, FRIDAY_AUTHOR_TOKEN: "  " }]) {
      if (!("FRIDAY_AUTHOR_TOKEN" in e) || e.FRIDAY_AUTHOR_TOKEN !== "  ")
        delete e.FRIDAY_AUTHOR_TOKEN;
      const f = fakeGit();
      const host = new GitCliHost({ tokenEnv: "FRIDAY_AUTHOR_TOKEN", env: e, gitBinary: f.bin });
      await expect(
        host.push({ worktree: tmp(), branch: "friday/152-x", commit: SHA }),
      ).rejects.toThrow("A variável de ambiente FRIDAY_AUTHOR_TOKEN não está definida.");
      expect(existsSync(f.out)).toBe(false);
    }
    expect(() => new GitCliHost({ tokenEnv: "  " })).toThrow(Error);
  });

  it("rejects an invalid branch, commit or worktree before running git", async () => {
    const f = fakeGit();
    const host = new GitCliHost({ tokenEnv: "FRIDAY_AUTHOR_TOKEN", env, gitBinary: f.bin });
    const wt = tmp();
    const bad = [
      ...["develop", "main", "--force", "friday/152-X", "friday/x", "feature/152-x", ""].map(
        (branch) => ({ worktree: wt, branch, commit: SHA }),
      ),
      ...["HEAD", "--force", "A".repeat(40), "a".repeat(39), ""].map((commit) => ({
        worktree: wt,
        branch: "friday/152-x",
        commit,
      })),
      { worktree: "", branch: "friday/152-x", commit: SHA },
    ];
    for (const req of bad) await expect(host.push(req)).rejects.toThrow(Error);
    expect(existsSync(f.out)).toBe(false);
    await expect(
      host.push({ worktree: wt, branch: "friday/152", commit: SHA }),
    ).resolves.toBeUndefined();
  });

  it("redacts the token from the git error", async () => {
    const f = fakeGit(true);
    const host = new GitCliHost({ tokenEnv: "FRIDAY_AUTHOR_TOKEN", env, gitBinary: f.bin });
    const err = await host
      .push({ worktree: tmp(), branch: "friday/152-x", commit: SHA })
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const e = err as Error;
    expect(e.message.startsWith("Falha no git push: ")).toBe(true);
    expect(e.message).toContain("***");
    expect(e.message).not.toContain(TOKEN);
    expect(e.message).not.toContain(B64);
    const cause = String((e as { cause?: unknown }).cause ?? "");
    expect(cause).not.toContain(TOKEN);
    expect(cause).not.toContain(B64);
  });

  it("rejects a commit that does not exist in the worktree", async () => {
    const r = repo();
    r.commit("c1");
    const host = new GitCliHost({ tokenEnv: "FRIDAY_AUTHOR_TOKEN", env });
    await expect(
      host.push({ worktree: r.wt, branch: "friday/152-y", commit: "b".repeat(40) }),
    ).rejects.toThrow(/^Falha no git push: /);
    expect(r.ref("refs/heads/friday/152-y")).toBe("");
  });

  it("is exported and adds no dependency", () => {
    expect(typeof GitCliHost).toBe("function");
    const src = readFileSync(new URL("../src/git-cli-host.ts", import.meta.url), "utf8");
    expect(src.split("process.env").length - 1).toBe(1);
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.execa).toBe("10.2.1");
  });

  it("does not run git hooks during the push", async () => {
    const r = repo();
    const c1 = r.commit("c1");
    const hooks = join(r.root, "hooks");
    const marker = join(r.root, "hook-ran");
    mkdirSync(hooks);
    writeFileSync(join(hooks, "pre-push"), `#!/bin/sh\nenv > ${marker}\n`);
    chmodSync(join(hooks, "pre-push"), 0o755);
    git(r.wt, "config", "core.hooksPath", hooks);
    const host = new GitCliHost({ tokenEnv: "FRIDAY_AUTHOR_TOKEN", env });
    await host.push({ worktree: r.wt, branch: "friday/152-z", commit: c1 });
    expect(r.ref("refs/heads/friday/152-z")).toBe(c1);
    expect(existsSync(marker)).toBe(false);
  });
});
