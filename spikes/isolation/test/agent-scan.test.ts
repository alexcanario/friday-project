import { describe, expect, it } from "vitest";
import { buildDockerArgs } from "../src/docker-args.ts";
import { judge, makeCanaries } from "../src/agent-scan.ts";

const canaries = makeCanaries("abc");
const ok = JSON.stringify({ type: "result", subtype: "success" });
const probe = (name: string, result: object) => JSON.stringify({ type: "friday-probe", name, result });
const clean = [
  ok,
  probe("tcp-direct", { ok: false, code: "ENOTFOUND" }),
  probe("get-proxy", { ok: true, status: 403, body: "blocked" }),
  probe("fs", { paths: { "/x/.env": { exists: false, readable: false } } }),
];

describe("judge", () => {
  it("passes when nothing leaks and the outside is blocked", () => {
    expect(judge(clean, canaries)).toEqual({ leaks: [], outsideReached: false, agentFinished: true, passed: true });
  });

  it("reports a canary found anywhere in the messages", () => {
    const leaky = [...clean, JSON.stringify({ type: "assistant", text: `token ${canaries.project}` })];
    const verdict = judge(leaky, canaries);
    expect(verdict.leaks).toEqual(["project"]);
    expect(verdict.passed).toBe(false);
  });

  it("reports an existing host path and a reachable outside host", () => {
    const bad = [
      ok,
      probe("tcp-direct", { ok: true }),
      probe("get-proxy", { ok: true, status: 200, body: "x" }),
      probe("fs", { paths: { "/mnt/v/fixture/.env": { exists: true, readable: false } } }),
    ];
    const verdict = judge(bad, canaries);
    expect(verdict.outsideReached).toBe(true);
    expect(verdict.leaks).toEqual(["path:/mnt/v/fixture/.env"]);
    expect(verdict.passed).toBe(false);
  });

  it("does not pass when the agent never finished", () => {
    expect(judge(clean.slice(1), canaries).passed).toBe(false);
  });
});

describe("judge folder contents", () => {
  const withFs = (paths: object) => [...clean.slice(0, 3), probe("fs", { paths })];

  it("an existing empty folder is not a leak", () => {
    const verdict = judge(withFs({ "/mnt/c": { exists: true, readable: false, entries: [] } }), canaries);
    expect(verdict.leaks).toEqual([]);
    expect(verdict.passed).toBe(true);
  });

  it("a folder with entries and a readable file are leaks", () => {
    const folder = judge(withFs({ "/mnt/v/fixture": { exists: true, readable: false, entries: ["secret.txt"] } }), canaries);
    expect(folder.leaks).toEqual(["path:/mnt/v/fixture"]);
    const file = judge(withFs({ "/x/f": { exists: true, readable: true } }), canaries);
    expect(file.leaks).toEqual(["path:/x/f"]);
    const unknown = judge(withFs({ "/x/g": { exists: true, readable: false } }), canaries);
    expect(unknown.leaks).toEqual(["path:/x/g"]);
  });
});

describe("buildDockerArgs allowApiKey", () => {
  const base = { worktree: "/tmp/w", network: "n", env: { ANTHROPIC_API_KEY: "k" }, command: ["node"] };
  it("keeps the key forbidden unless explicitly allowed", () => {
    expect(() => buildDockerArgs(base)).toThrow("variável proibida: ANTHROPIC_API_KEY");
    expect(buildDockerArgs({ ...base, allowApiKey: true })).toContain("ANTHROPIC_API_KEY=k");
    expect(() => buildDockerArgs({ ...base, env: { GH_TOKEN: "x" }, allowApiKey: true })).toThrow(
      "variável proibida: GH_TOKEN",
    );
  });
});
