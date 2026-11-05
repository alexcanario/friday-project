import { chmodSync, copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDockerArgs } from "../src/docker-args.ts";
import { createStack, type Stack } from "../src/stack.ts";
import { docker, skipDocker } from "./helpers.ts";

interface GetResult {
  ok: boolean;
  status?: number;
  body?: string;
  code?: string;
}

const failures = ["ENOTFOUND", "ECONNREFUSED", "ENETUNREACH", "ETIMEDOUT"];

describe.skipIf(skipDocker)("network egress", () => {
  let stack: Stack;
  let worktree: string;

  beforeAll(() => {
    worktree = mkdtempSync(join(tmpdir(), "friday-net-"));
    copyFileSync(resolve(import.meta.dirname, "../src/probe.ts"), join(worktree, "probe.ts"));
    writeFileSync(join(worktree, "hello.txt"), "ok");
    chmodSync(worktree, 0o755);
    chmodSync(join(worktree, "probe.ts"), 0o644);
    stack = createStack();
  });

  afterAll(() => {
    stack?.destroy();
    rmSync(worktree, { recursive: true, force: true });
  });

  function probe(command: string[], env: Record<string, string> = {}): GetResult {
    const args = buildDockerArgs({ worktree, network: stack.agentNetwork, env, command: ["node", "probe.ts", ...command] });
    return JSON.parse(docker(args)) as GetResult;
  }

  it("proxy forwards allowlisted host and blocks others", () => {
    const env = { HTTP_PROXY: stack.proxyUrl };
    const allowed = probe(["get", "http://allowed.test/"], env);
    expect(allowed).toMatchObject({ ok: true, status: 200, body: "allowed" });
    const blocked = probe(["get", "http://blocked.test/"], env);
    expect(blocked).toMatchObject({ ok: true, status: 403 });
  });

  it("container has no direct egress", () => {
    const byName = probe(["get", "http://allowed.test/"]);
    expect(byName.ok).toBe(false);
    expect(failures).toContain(byName.code);
    const byIp = probe(["tcp", "1.1.1.1", "443"]);
    expect(byIp.ok).toBe(false);
    expect(failures).toContain(byIp.code);
  });
});
