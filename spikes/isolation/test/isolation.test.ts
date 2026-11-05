import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDockerArgs } from "../src/docker-args.ts";
import { docker, skipDocker } from "./helpers.ts";

const probeSource = resolve(import.meta.dirname, "../src/probe.ts");
const canaryEnv = { ANTHROPIC_API_KEY: "CANARY-KEY", GITHUB_TOKEN: "CANARY-GH", GH_TOKEN: "CANARY-GH2" };

interface PathInfo {
  exists: boolean;
  readable: boolean;
  content?: string;
}
interface ProbeResult {
  worktreeRead: string | null;
  uid: number;
  env: Record<string, string>;
  paths: Record<string, PathInfo>;
  etcWrite: boolean;
  leaked: boolean;
}

describe.skipIf(skipDocker)("container isolation", () => {
  let root: string;
  let home: string;
  let worktree: string;
  let secretPath: string;
  let saved: Record<string, string | undefined>;
  let paths: string[];

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "friday-iso-"));
    home = join(root, "home");
    worktree = join(root, "work");
    secretPath = join(root, "other-project", "secret.txt");
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(root, "other-project"));
    mkdirSync(worktree);
    writeFileSync(join(home, ".claude", "token"), "CANARY-CLAUDE");
    writeFileSync(join(home, ".env"), "CANARY-ENV");
    writeFileSync(secretPath, "CANARY-OTHER");
    writeFileSync(join(worktree, "hello.txt"), "ok");
    copyFileSync(probeSource, join(worktree, "probe.ts"));
    for (const dir of [root, home, worktree, join(root, "other-project"), join(home, ".claude")]) chmodSync(dir, 0o755);
    for (const file of [join(home, ".claude", "token"), join(home, ".env"), secretPath]) chmodSync(file, 0o644);
    for (const file of ["hello.txt", "probe.ts"]) chmodSync(join(worktree, file), 0o644);
    saved = Object.fromEntries(Object.keys(canaryEnv).map((key) => [key, process.env[key]]));
    Object.assign(process.env, canaryEnv);
    paths = [
      "/var/run/docker.sock",
      "/root/.claude",
      "/home/node/.claude",
      "/home/node/.claude/token",
      home,
      join(home, ".claude", "token"),
      join(home, ".env"),
      secretPath,
    ];
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("container cannot read host secrets or other projects", () => {
    const args = buildDockerArgs({
      worktree,
      network: "none",
      env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
      command: ["node", "probe.ts", "fs", JSON.stringify(paths)],
    });
    const result = JSON.parse(docker(args)) as ProbeResult;
    expect(result.worktreeRead).toBe("ok");
    expect(result.uid).toBe(1000);
    for (const key of Object.keys(canaryEnv)) expect(result.env).not.toHaveProperty(key);
    expect(JSON.stringify(result.env)).not.toContain("CANARY-");
    expect(result.paths["/var/run/docker.sock"]?.exists).toBe(false);
    for (const path of ["/root/.claude", "/home/node/.claude", home]) {
      expect(result.paths[path]?.exists, path).toBe(false);
    }
    expect(result.paths[secretPath]?.readable).toBe(false);
    expect(result.etcWrite).toBe(false);
    expect(result.leaked).toBe(false);
  });

  it("probe detects a deliberate leak", () => {
    const out = docker([
      "run", "--rm", "--label", "friday-spike=isolation", "--network", "none",
      "-v", `${home}:/home/node`, "-v", `${worktree}:/work:ro`, "-w", "/work",
      "-e", "ANTHROPIC_API_KEY=CANARY-KEY",
      "node:26-slim", "node", "probe.ts", "fs", JSON.stringify(["/home/node/.claude/token"]),
    ]);
    const result = JSON.parse(out) as ProbeResult;
    expect(result.leaked).toBe(true);
    expect(result.env.ANTHROPIC_API_KEY).toBe("CANARY-KEY");
    expect(result.paths["/home/node/.claude/token"]?.content).toBe("CANARY-CLAUDE");
  });
});
