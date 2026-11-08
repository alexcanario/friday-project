import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildEffectsRun, type EffectsRun } from "../src/index.ts";

const VALID: EffectsRun = {
  issue: 96,
  role: "specialist",
  branch: "friday/96-x",
  base: "develop",
  worktree: "/w",
  getPullRequest: () => 7,
};

describe("buildEffectsRun", () => {
  it("accepts the optional onPrCreated and still works without it", () => {
    const onPrCreated = (_pr: number): void => {};
    expect(() => buildEffectsRun({ ...VALID, onPrCreated })).not.toThrow();
    expect(() => buildEffectsRun(VALID)).not.toThrow();
  });

  it("returns the run with the same six fields", () => {
    const run = buildEffectsRun(VALID);
    expect(run.issue).toBe(96);
    expect(run.role).toBe("specialist");
    expect(run.branch).toBe("friday/96-x");
    expect(run.base).toBe("develop");
    expect(run.worktree).toBe("/w");
    expect(run.getPullRequest()).toBe(7);
    expect(buildEffectsRun({ ...VALID, getPullRequest: () => null }).getPullRequest()).toBeNull();
    expect(buildEffectsRun({ ...VALID, branch: "friday/96" }).branch).toBe("friday/96");
  });

  it("rejects an invalid run", () => {
    const bad: Array<Partial<EffectsRun>> = [
      { issue: 0 },
      { issue: 1.5 },
      { role: "" },
      { branch: "" },
      { base: "" },
      { worktree: "" },
      { branch: "develop", base: "develop" },
      { branch: "friday/97-x", issue: 96 },
      { branch: "feature/96-x" },
      { branch: "friday/96-X" },
    ];
    for (const over of bad) {
      expect(() => buildEffectsRun({ ...VALID, ...over }), JSON.stringify(over)).toThrow(Error);
    }
  });

  it("has no infrastructure or contracts import", () => {
    const source = readFileSync(new URL("../src/effects-run.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/@friday\/(infrastructure|contracts)/);
  });
});
