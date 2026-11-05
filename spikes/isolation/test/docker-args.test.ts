import { homedir } from "node:os";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDockerArgs } from "../src/docker-args.ts";

const base = { worktree: "/tmp/w", network: "net-a", env: { PATH: "/usr/bin" }, command: ["node", "probe.ts"] };

function valuesAfter(args: string[], flag: string): string[] {
  return args.flatMap((arg, i) => (arg === flag ? [args[i + 1] as string] : []));
}

describe("buildDockerArgs", () => {
  it("builds a locked-down docker run", () => {
    const args = buildDockerArgs(base);
    for (const item of [
      "--user",
      "1000:1000",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--network",
      "net-a",
      "--label",
      "friday-spike=isolation",
      "node:26-slim",
    ]) {
      expect(args).toContain(item);
    }
    expect(valuesAfter(args, "-v")).toEqual(["/tmp/w:/work"]);
    expect(valuesAfter(args, "-e")).toEqual(["PATH=/usr/bin"]);
    expect(args).not.toContain("--env-file");
    expect(args).not.toContain("--privileged");
    expect(args).not.toContain("--network=host");
    expect(args.slice(-2)).toEqual(["node", "probe.ts"]);
  });

  it("rejects forbidden mounts and env, accepts none", () => {
    for (const path of ["/var/run/docker.sock", "/home/a/.claude", "/home/a/.ssh", "/proj/.env", homedir()]) {
      expect(() => buildDockerArgs({ ...base, extraMounts: [path] })).toThrow(`montagem proibida: ${path}`);
    }
    for (const path of ["/home/a/.claude/token", "/home/a/.ssh/id_rsa", "/proj/.env/x", dirname(homedir())]) {
      expect(() => buildDockerArgs({ ...base, extraMounts: [path] })).toThrow(`montagem proibida: ${path}`);
      expect(() => buildDockerArgs({ ...base, worktree: path })).toThrow(`montagem proibida: ${path}`);
    }
    expect(() => buildDockerArgs({ ...base, extraMounts: ["/home/a/.claude-notes"] })).not.toThrow();
    for (const key of ["ANTHROPIC_API_KEY", "GITHUB_TOKEN", "GH_TOKEN"]) {
      expect(() => buildDockerArgs({ ...base, env: { [key]: "x" } })).toThrow(`variável proibida: ${key}`);
    }
    expect(() => buildDockerArgs({ ...base, extraMounts: [], env: {} })).not.toThrow();
  });
});
