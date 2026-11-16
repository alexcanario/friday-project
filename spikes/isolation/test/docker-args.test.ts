import { homedir } from "node:os";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDockerArgs, splitMount } from "../src/docker-args.ts";

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

describe("mount and env hardening", () => {
  it("splitMount keeps the drive letter of a Windows path", () => {
    expect(splitMount("V:\\repo\\w:/work:ro")).toEqual({ host: "V:\\repo\\w", rest: "/work:ro" });
    expect(splitMount("/tmp/w:/work")).toEqual({ host: "/tmp/w", rest: "/work" });
    expect(splitMount("/data")).toEqual({ host: "/data", rest: "" });
  });

  it("rejects forbidden Windows mounts and mounts allowed ones read-only", () => {
    expect(() => buildDockerArgs({ ...base, extraMounts: ["V:\\Users\\a\\.ssh"] })).toThrow("montagem proibida: V:\\Users\\a\\.ssh");
    expect(() => buildDockerArgs({ ...base, extraMounts: ["V:\\Users\\a\\.claude\\token:/x"] })).toThrow(
      "montagem proibida: V:\\Users\\a\\.claude\\token",
    );
    const args = buildDockerArgs({ ...base, extraMounts: ["V:\\data:/mnt/d"] });
    expect(valuesAfter(args, "-v")).toContain("V:\\data:/mnt/d:ro");
  });

  it("forces :ro on every extra mount and rejects :rw", () => {
    const mount = (extra: string) => valuesAfter(buildDockerArgs({ ...base, extraMounts: [extra] }), "-v")[1];
    expect(mount("/data:/mnt/d")).toBe("/data:/mnt/d:ro");
    expect(mount("/data:/mnt/d:ro")).toBe("/data:/mnt/d:ro");
    expect(mount("/data")).toBe("/data:/data:ro");
    expect(() => buildDockerArgs({ ...base, extraMounts: ["/data:/mnt/d:rw"] })).toThrow("montagem proibida: /data:/mnt/d:rw");
  });

  it("refuses every token variable with and without allowApiKey", () => {
    for (const key of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"]) {
      for (const allowApiKey of [false, true]) {
        expect(() => buildDockerArgs({ ...base, env: { [key]: "x" }, allowApiKey }), key).toThrow(`variável proibida: ${key}`);
      }
    }
    const env = { ANTHROPIC_API_KEY: "k" };
    expect(buildDockerArgs({ ...base, env, allowApiKey: true })).toContain("ANTHROPIC_API_KEY=k");
    expect(() => buildDockerArgs({ ...base, env })).toThrow("variável proibida: ANTHROPIC_API_KEY");
  });
});

describe("judge findings on docker-args", () => {
  it("rejects every way to reach the Docker socket, on any operating system", () => {
    for (const path of [
      "/var/run/docker.sock",
      "//var/run/docker.sock",
      "V:\\var\\run\\docker.sock",
      "/run/docker.sock",
      "/var/run",
      "/run",
      "/opt/x/docker.sock",
      "/var/run/",
      "/run/",
      "/var/",
      "V:\\var\\run\\",
      "../../../../../../../../../../var/run",
      "../../../../../../../../../../run",
      "..\\..\\..\\..\\..\\..\\..\\..\\..\\..\\var\\run",
      ".",
      "./run",
    ]) {
      expect(() => buildDockerArgs({ ...base, extraMounts: [path] }), path).toThrow(`montagem proibida: ${path}`);
    }
    expect(() => buildDockerArgs({ ...base, extraMounts: ["/var/run/:/x"] })).toThrow("montagem proibida: /var/run/");
  });

  it("matches the forbidden folders without regard to letter case", () => {
    for (const path of ["V:\\Users\\a\\.SSH", "C:\\Users\\a\\.Claude", "/home/a/.ENV"]) {
      expect(() => buildDockerArgs({ ...base, extraMounts: [path] }), path).toThrow(`montagem proibida: ${path}`);
    }
  });

  it("refuses variable names that smuggle a value or are not identifiers", () => {
    for (const key of ["GITHUB_TOKEN=ghp_x", "A B", "1X", ""]) {
      expect(() => buildDockerArgs({ ...base, env: { [key]: "y" } }), key).toThrow(`variável proibida: ${key}`);
    }
  });
});
