import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitCliHost } from "../src/index.ts";
import { makeRepoFixture } from "./git-cli-host-fixture.ts";

const SHA = "a".repeat(40);

let dir: string;
let wt: string;
let mirror: string;
let targetUrl: string;

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

function calls(log: string): { argv: string[]; env: Record<string, string> }[] {
  try {
    return readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as { argv: string[]; env: Record<string, string> });
  } catch {
    return [];
  }
}

function pushedToken(env: Record<string, string>): string {
  const count = Number(env.GIT_CONFIG_COUNT);
  for (let i = 0; i < count; i++) {
    if (env[`GIT_CONFIG_KEY_${i}`] !== "http.https://github.com/.extraheader") continue;
    const b64 = (env[`GIT_CONFIG_VALUE_${i}`] ?? "").replace("Authorization: basic ", "");
    return Buffer.from(b64, "base64").toString("utf8").replace("x-access-token:", "");
  }
  throw new Error("extraheader not found");
}

beforeEach(() => {
  ({ dir, wt, mirror, targetUrl } = makeRepoFixture("git-cli-host-token-"));
  mkdirSync(mirror);
  writeFileSync(join(mirror, "HEAD"), "ref: refs/heads/main\n");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const request = () => ({ worktree: wt, branch: "friday/182-x", message: "feat: x" });

describe("GitCliHost with a token provider", () => {
  it("push uses the token returned by the provider on each call", async () => {
    const { bin, log } = fakeGit();
    let n = 0;
    const host = new GitCliHost({
      token: async () => `ghs_tok${++n}`,
      mirrorDir: mirror,
      targetUrl,
      env: { PATH: process.env.PATH },
      gitBinary: bin,
    });
    await host.push(request());
    const first = calls(log);
    expect(pushedToken(first[first.length - 1]!.env)).toBe("ghs_tok1");
    await host.push(request());
    const all = calls(log);
    expect(pushedToken(all[all.length - 1]!.env)).toBe("ghs_tok2");
  });

  it("rejects token with tokenEnv, neither, or an empty token", async () => {
    const base = { mirrorDir: mirror, targetUrl };
    expect(
      () => new GitCliHost({ ...base, token: async () => "x", tokenEnv: "FRIDAY_AUTHOR_TOKEN" }),
    ).toThrow(Error);
    expect(() => new GitCliHost({ ...base })).toThrow(Error);
    for (const value of ["", "   "]) {
      const { bin, log } = fakeGit();
      const host = new GitCliHost({ ...base, token: async () => value, gitBinary: bin });
      await expect(host.push(request())).rejects.toThrow(/token/i);
      expect(calls(log)).toHaveLength(0);
    }
  });
});
