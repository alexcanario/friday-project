import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHubPort, WorktreeManager } from "@friday/application";
import { vi } from "vitest";
import type { ComposeOptions } from "../src/index.ts";
import { FakeClock, FakeGitHub, PendingRuntime } from "./fakes.ts";

export const fixture = join(
  import.meta.dirname,
  "../../../packages/infrastructure/test/fixtures/valid",
);
export const NOW = new Date("2026-11-05T03:00:00.000Z");
const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });

export function fakeWorktrees(): WorktreeManager {
  return {
    create: vi.fn(),
    remove: vi.fn(() => ok(undefined)),
    list: vi.fn(() => ok([])),
    listOrphans: vi.fn(() => ok([])),
    isClean: vi.fn(() => Promise.resolve(true)),
  } as unknown as WorktreeManager;
}

export function setup(edit: (yaml: string) => string = (y) => y) {
  const root = mkdtempSync(join(tmpdir(), "friday-compose-"));
  cpSync(fixture, root, { recursive: true });
  const file = join(root, "factory.yaml");
  const yaml = readFileSync(file, "utf8").replace(
    "  merge: manual\n",
    "  merge: manual\n  author_token_env: FRIDAY_AUTHOR_TOKEN\n",
  );
  writeFileSync(file, edit(yaml));
  const github = new FakeGitHub();
  const logs: string[] = [];
  const createGitHub = vi.fn<(token: string, repo: { owner: string; repo: string }) => FakeGitHub>(
    () => github,
  );
  const opts: ComposeOptions = {
    root,
    dbPath: join(root, "friday.db"),
    projectId: "p",
    env: { FRIDAY_AUTHOR_TOKEN: "t0k3n" },
    worktrees: fakeWorktrees(),
    runtime: new PendingRuntime(),
    prOf: () => null,
    clock: new FakeClock(),
    lock: { pid: 101, kill: () => undefined },
    now: () => NOW,
    log: (m) => logs.push(m),
    createGitHub: createGitHub as unknown as (
      token: string,
      repo: { owner: string; repo: string },
    ) => GitHubPort,
  };
  return { root, opts, github, logs, createGitHub };
}
