import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, vi } from "vitest";
import type { Daemon } from "@friday/daemon";
import { runDaemonCommand, type DaemonDeps } from "../src/daemon.ts";

export const fixture = resolve(
  import.meta.dirname,
  "../../../packages/infrastructure/test/fixtures/valid",
);

export function validRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "friday-daemon-"));
  cpSync(fixture, dir, { recursive: true });
  writeFileSync(
    join(dir, "agents", "judge-strong.yaml"),
    "role: judge-strong\nstates: [InReview]\nmodel: opus\nmax_budget_usd: 3\nmax_turns: 40\ntimeout_s: 3600\ntools: [Read, Glob, Grep, Bash]\nmcp_tools:\n  - review_verdict\n  - issue_comment\nprompt_file: prompts/judge.md\n",
  );
  return dir;
}

export function setup(
  env: Record<string, string | undefined>,
  over: Partial<DaemonDeps> = {},
  homeDir = "/h",
) {
  const stop = vi.fn();
  const order: string[] = [];
  const idle = vi.fn(async () => {
    order.push("idle");
  });
  const release = vi.fn(() => {
    order.push("release");
  });
  stop.mockImplementation(() => order.push("stop"));
  const start = vi.fn(() => stop);
  const daemon = { ticker: { start, idle }, db: {}, report: {}, release } as unknown as Daemon;
  const compose = vi.fn(async () => daemon);
  const worktrees = {} as never;
  const createWorktrees = vi.fn(() => worktrees);
  const clock = { now: () => 1, every: () => () => {} };
  let handler: (() => void) | undefined;
  const onSignal = vi.fn((h: () => void) => {
    handler = h;
  });
  const deps = {
    env,
    homeDir,
    compose,
    createWorktrees,
    clock,
    onSignal,
    ...over,
  } as unknown as DaemonDeps;
  return {
    deps,
    compose,
    createWorktrees,
    clock,
    worktrees,
    start,
    stop,
    idle,
    release,
    order,
    fire: () => handler?.(),
  };
}

export async function runUntilSignal(s: ReturnType<typeof setup>, args = ["daemon"]) {
  const p = runDaemonCommand(args, s.deps);
  await vi.waitFor(() => expect(s.start).toHaveBeenCalled());
  s.fire();
  return p;
}

