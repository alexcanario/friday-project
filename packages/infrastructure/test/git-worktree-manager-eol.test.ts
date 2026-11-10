import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeEolScenario } from "./eol-scenario.ts";

afterEach(() => vi.unstubAllEnvs());

describe("GitWorktreeManager end-of-line handling", () => {
  it("create keeps LF when global autocrlf is true", async () => {
    const { worktree } = await makeEolScenario();
    expect(readFileSync(join(worktree, "eol.txt")).toString("latin1")).toBe("a\nb\n");
  });
});
