import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRuntime, GitHost, WorktreeManager } from "@friday/application";
import type { ClaudeAgentSdkRuntimeDeps, GitCliHostOptions } from "@friday/infrastructure";
import { vi } from "vitest";
import type { ComposeOptions } from "../src/index.ts";
import { FakeClock, FakeGitHub, PendingRuntime, fakeRequest } from "./fakes.ts";

const fixture = join(import.meta.dirname, "../../../packages/infrastructure/test/fixtures/valid");
const NOW = new Date("2026-11-05T03:00:00.000Z");
const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });

export type SetupOptions = {
  tokenEnv?: string;
  env?: Record<string, string | undefined>;
  withGitHostSpy?: boolean;
  createRuntimeThrows?: boolean;
};

export function setupCompose(o: SetupOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "friday-rt-"));
  const home = mkdtempSync(join(tmpdir(), "friday-home-"));
  cpSync(fixture, root, { recursive: true });
  const file = join(root, "factory.yaml");
  const yaml = readFileSync(file, "utf8").replace(
    "  merge: manual\n",
    `  merge: manual\n  author_token_env: ${o.tokenEnv ?? "FRIDAY_AUTHOR_TOKEN"}\n`,
  );
  writeFileSync(file, yaml);
  const github = new FakeGitHub();
  github.issues.push({ number: 7, title: "Issue", labels: ["friday"] } as never);
  const gitHost = { push: vi.fn() } as unknown as GitHost;
  const createGitHost = vi.fn<(options: GitCliHostOptions) => GitHost>(() => gitHost);
  const runs: Array<{ deps: ClaudeAgentSdkRuntimeDeps; run: ReturnType<typeof vi.fn> }> = [];
  const gates: Array<() => void> = [];
  const createRuntime = vi.fn((deps: ClaudeAgentSdkRuntimeDeps) => {
    if (o.createRuntimeThrows) throw new Error("boom");
    const run = vi.fn(
      () =>
        new Promise((resolve) => {
          gates.push(() =>
            resolve({
              status: "succeeded",
              subtype: null,
              model: null,
              costUsd: 0.1,
              tokens: null,
              numTurns: null,
              durationMs: null,
              output: null,
              violations: [],
            }),
          );
        }),
    );
    runs.push({ deps, run });
    return { run } as unknown as AgentRuntime;
  });
  const optsRuntime = new PendingRuntime();
  const optsRun = vi.spyOn(optsRuntime, "run");
  const worktrees = {
    create: vi.fn(),
    remove: vi.fn(() => ok(undefined)),
    list: vi.fn(() => ok([])),
    listOrphans: vi.fn(() => ok([])),
    isClean: vi.fn(() => Promise.resolve(true)),
  } as unknown as WorktreeManager;
  const env = o.env ?? { FRIDAY_AUTHOR_TOKEN: "t0k3n", FRIDAY_HOME: home };
  const opts: ComposeOptions = {
    root,
    dbPath: join(root, "friday.db"),
    projectId: "p",
    env,
    worktrees,
    runtime: optsRuntime,
    prOf: () => null,
    clock: new FakeClock(),
    lock: { pid: 101, kill: () => undefined },
    now: () => NOW,
    createGitHub: (() => github) as unknown as ComposeOptions["createGitHub"],
    createRuntime,
    ...(o.withGitHostSpy === false ? {} : { createGitHost }),
    roles: { triage: (id) => fakeRequest(id) },
  };
  return { opts, root, home, github, gitHost, createGitHost, createRuntime, runs, gates, optsRun };
}
