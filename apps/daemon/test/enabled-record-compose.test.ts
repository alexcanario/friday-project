import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHubPort, WorktreeManager } from "@friday/application";
import { createProjectEnabledRepository } from "@friday/infrastructure";
import { describe, expect, it, vi } from "vitest";
import { composeDaemon, type ComposeOptions } from "../src/index.ts";
import { FakeClock, FakeGitHub, PendingRuntime } from "./fakes.ts";

const fixture = join(import.meta.dirname, "../../../packages/infrastructure/test/fixtures/valid");

function fakeWorktrees(): WorktreeManager {
  const ok = Promise.resolve({ ok: true as const, value: [] });
  return {
    create: vi.fn(),
    remove: vi.fn(() => Promise.resolve({ ok: true as const, value: undefined })),
    list: vi.fn(() => ok),
    listOrphans: vi.fn(() => ok),
    isClean: vi.fn(() => Promise.resolve(true)),
  } as unknown as WorktreeManager;
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "friday-enabled-record-"));
  cpSync(fixture, root, { recursive: true });
  const opts: ComposeOptions = {
    root,
    repoDir: join(root, "repos", "p__r"),
    dbPath: join(root, "friday.db"),
    projectId: "p",
    env: { FRIDAY_AUTHOR_TOKEN: "t0k3n" },
    worktrees: fakeWorktrees(),
    runtime: new PendingRuntime(),
    prOf: () => null,
    clock: new FakeClock(),
    lock: { pid: 101, kill: () => undefined },
    now: () => new Date(Date.parse("2026-11-05T03:00:00.000Z")),
    createGitHub: (() => new FakeGitHub()) as unknown as (
      token: string,
      repo: { owner: string; repo: string },
    ) => GitHubPort,
  };
  return { root, opts };
}

describe("composeDaemon enabled record", () => {
  it("composeDaemon stores enabled from factory.yaml on each tick", async () => {
    const { root, opts } = setup();
    const file = join(root, "factory.yaml");
    const yaml = readFileSync(file, "utf8");
    const daemon = await composeDaemon(opts);
    const repo = createProjectEnabledRepository(daemon.db);

    writeFileSync(file, yaml.replace("enabled: true", "enabled: false"));
    await daemon.ticker.tick();
    expect(repo.get("p")).toBe(false);

    writeFileSync(file, yaml);
    await daemon.ticker.tick();
    expect(repo.get("p")).toBe(true);

    writeFileSync(file, "enabled: [");
    await daemon.ticker.tick();
    expect(repo.get("p")).toBe(true);
    daemon.release();
  });
});
