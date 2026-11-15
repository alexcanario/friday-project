import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeEolScenario } from "./eol-scenario.ts";

let cleanup: (() => void) | undefined;

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup?.();
  cleanup = undefined;
});

describe("GitWorktreeManager end-of-line handling", () => {
  it("create keeps LF when global autocrlf is true", async () => {
    const scenario = await makeEolScenario();
    cleanup = scenario.cleanup;
    const { worktree } = scenario;
    expect(readFileSync(join(worktree, "eol.txt")).toString("latin1")).toBe("a\nb\n");
  });
});
