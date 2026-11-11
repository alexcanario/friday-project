import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { daemonPaths, judgeInputOf, projectIdOf } from "../src/daemon-values.ts";

const repository = { owner: "alexcanario", name: "friday-sandbox" };

describe("daemon values", () => {
  it("daemonPaths derives root, db and clone from FRIDAY_HOME or home", () => {
    const abs = join(import.meta.dirname, "central");
    expect(daemonPaths({ env: { FRIDAY_HOME: abs }, homeDir: "/h", repository })).toEqual({
      root: abs,
      dbPath: join(abs, "friday.db"),
      repoDir: join(abs, "repos", "alexcanario__friday-sandbox"),
    });
    for (const env of [{}, { FRIDAY_HOME: "" }]) {
      expect(daemonPaths({ env, homeDir: "/h", repository }).root).toBe(join("/h", ".friday"));
    }
  });

  it("projectIdOf joins owner and name", () => {
    expect(projectIdOf(repository)).toBe("alexcanario/friday-sandbox");
  });
});

describe("judgeInputOf", () => {
  const SHA = "a".repeat(40);
  const P = (n: number, sha: string) =>
    `Review the pull request of issue #${n}. The head SHA of the pull request is ${sha}. Read the diff with pr_diff and finish by calling review_verdict once, with that value in headSha.`;

  it("judgeInputOf derives cwd, prompt and configRoot", () => {
    expect(judgeInputOf({ root: "/c", repository, issueId: 7, headSha: SHA })).toEqual({
      cwd: join("/c", "worktrees", "alexcanario__friday-sandbox", "7"),
      prompt: P(7, SHA),
      configRoot: "/c",
    });
  });

  it("judgeInputOf puts the head SHA in the prompt", () => {
    const headSha = "0123456789abcdef".repeat(2) + "01234567";
    const { prompt } = judgeInputOf({ root: "/c", repository, issueId: 7, headSha });
    expect(prompt).toBe(P(7, headSha));
    expect(prompt).toContain(headSha);
  });

  it("judgeInputOf rejects an invalid head SHA", () => {
    for (const headSha of ["abc", "A".repeat(40), "", "g".repeat(40), "a".repeat(41)]) {
      expect(() => judgeInputOf({ root: "/c", repository, issueId: 7, headSha })).toThrow(Error);
    }
  });

  it("judgeInputOf rejects an invalid issue id", () => {
    for (const issueId of [0, -1, 1.5, Number.NaN]) {
      expect(() => judgeInputOf({ root: "/c", repository, issueId, headSha: SHA })).toThrow(Error);
    }
  });
});
