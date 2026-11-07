import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GitHubPort, PrDiff } from "@friday/application";
import { GitHubRestAdapter } from "@friday/infrastructure";
import { createGitHubFake, createTestOctokit } from "./github-fake.ts";

describe("GitHubPort", () => {
  it("adapter satisfies GitHubPort and uses only REST routes", async () => {
    const fake = createGitHubFake();
    fake.issues = [{ number: 5, labels: ["friday"] }];
    fake.pulls = [{ number: 30, head: "o:h", headRef: "h", base: "develop", sha: "abc" }];
    fake.checkRuns.set("abc", [
      { id: 1, name: "check", status: "completed", conclusion: "success" },
    ]);
    fake.files.set(30, [{ filename: "a.ts", additions: 1, deletions: 0, patch: "x" }]);
    const adapter = new GitHubRestAdapter(createTestOctokit(fake.fetch), {
      owner: "o",
      repo: "r",
    }) satisfies GitHubPort;
    const port: GitHubPort = adapter;
    await port.listIssuesByLabel("friday");
    await port.addLabel(5, "a");
    await port.removeLabel(5, "a");
    await port.postAgentComment(5, "qa", "x");
    await port.createPullRequest({ head: "h", base: "develop", title: "t", body: "b" });
    await port.getCiStatus(30, "check");
    const diff: PrDiff = await port.getPrDiff(30);
    expect(diff.diffBytes).toBe(1);
    await port.squashMerge(30, "abc");
    expect(await port.getPrMergeState(30)).toEqual({ merged: false, headSha: "abc" });
    expect(fake.calls.length).toBeGreaterThan(0);
    for (const call of fake.calls) {
      expect(call.path.startsWith("/repos/o/r/")).toBe(true);
      expect(call.path).not.toContain("graphql");
    }
  });

  it("octokit is pinned", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.octokit).toBe("5.0.5");
  });
});
