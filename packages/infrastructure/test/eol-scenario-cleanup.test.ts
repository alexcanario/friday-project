import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeEolScenario } from "./eol-scenario.ts";
import { makeFixture } from "./worktree-helpers.ts";

const extra: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of extra.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("makeFixture", () => {
  it("makeFixture exposes the base directory that holds repo, origin and worktree root", () => {
    const fx = makeFixture();
    extra.push(fx.base);
    expect(existsSync(fx.base)).toBe(true);
    expect(dirname(fx.repoDir)).toBe(fx.base);
    expect(dirname(fx.root)).toBe(fx.base);
  });
});

describe("makeEolScenario cleanup", () => {
  it("makeEolScenario returns base, cfgDir and cleanup, and the directories exist before it", async () => {
    const { worktree, base, cfgDir, cleanup } = await makeEolScenario();
    try {
      expect(existsSync(base)).toBe(true);
      expect(existsSync(cfgDir)).toBe(true);
      expect(existsSync(worktree)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("cleanup removes the fixture base, the worktree and the global config dir", async () => {
    const { repoDir, worktree, base, cfgDir, cleanup } = await makeEolScenario();
    cleanup();
    expect(existsSync(worktree)).toBe(false);
    expect(existsSync(repoDir)).toBe(false);
    expect(existsSync(base)).toBe(false);
    expect(existsSync(cfgDir)).toBe(false);
  });

  it("cleanup can be called twice without error", async () => {
    const { cleanup } = await makeEolScenario();
    cleanup();
    expect(() => cleanup()).not.toThrow();
  });

  it("cleanup leaves unrelated temp directories alone", async () => {
    const keep = mkdtempSync(join(tmpdir(), "friday-keep-"));
    extra.push(keep);
    const { cleanup } = await makeEolScenario();
    cleanup();
    expect(existsSync(keep)).toBe(true);
  });
});
