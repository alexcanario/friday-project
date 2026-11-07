import type { Octokit } from "octokit";
import { afterAll, describe, expect, it, vi } from "vitest";
import { GitHubRestAdapter, createGitHubClient } from "../src/index.ts";

// Live check of #122: runs only with FRIDAY_GH_LIVE=1 and a real token in FRIDAY_GH_TOKEN.
const LIVE = process.env.FRIDAY_GH_LIVE === "1";
const repo = { owner: "alexcanario", repo: process.env.FRIDAY_GH_REPO ?? "friday-sandbox" };
const stamp = `${Date.now()}`;
const branch = `friday-live-${stamp}`;
const cleanup: Array<() => Promise<unknown>> = [];
const SETTLE = { timeout: 15_000, interval: 1_000 };

async function ensureLabel(octokit: Octokit, name: string): Promise<void> {
  try {
    await octokit.request("GET /repos/{owner}/{repo}/labels/{name}", { ...repo, name });
  } catch {
    await octokit.request("POST /repos/{owner}/{repo}/labels", { ...repo, name, color: "5319e7" });
  }
}

async function createBranchWithFile(octokit: Octokit): Promise<void> {
  const base = await octokit.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
    ...repo,
    ref: "heads/develop",
  });
  const parent = base.data.object.sha;
  const parentCommit = await octokit.request("GET /repos/{owner}/{repo}/git/commits/{commit_sha}", {
    ...repo,
    commit_sha: parent,
  });
  const tree = await octokit.request("POST /repos/{owner}/{repo}/git/trees", {
    ...repo,
    base_tree: parentCommit.data.tree.sha,
    tree: [{ path: `live/${stamp}.txt`, mode: "100644", type: "blob", content: "teste vivo\n" }],
  });
  const commit = await octokit.request("POST /repos/{owner}/{repo}/git/commits", {
    ...repo,
    message: `test: teste vivo da #122 (${stamp})`,
    tree: tree.data.sha,
    parents: [parent],
  });
  await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
    ...repo,
    ref: `refs/heads/${branch}`,
    sha: commit.data.sha,
  });
  cleanup.push(() =>
    octokit
      .request("DELETE /repos/{owner}/{repo}/git/refs/{ref}", { ...repo, ref: `heads/${branch}` })
      .catch(() => undefined),
  );
}

describe.skipIf(!LIVE)("GitHubRestAdapter (live, #122)", () => {
  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
  });

  it("runs every port method against the sandbox", { timeout: 120_000 }, async () => {
    const octokit = createGitHubClient(process.env.FRIDAY_GH_TOKEN ?? "");
    const port = new GitHubRestAdapter(octokit, repo);
    await ensureLabel(octokit, "friday");
    const made = await octokit.request("POST /repos/{owner}/{repo}/issues", {
      ...repo,
      title: `Teste vivo da #122 (${stamp})`,
      labels: ["friday"],
    });
    const issue = made.data.number;
    cleanup.push(() =>
      octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
        ...repo,
        issue_number: issue,
        state: "closed",
      }),
    );

    // GitHub lists are eventually consistent: a write can take a few seconds to show up.
    const labelsOf = async () =>
      (await port.listIssuesByLabel("friday")).find((i) => i.number === issue)?.labels;
    await vi.waitFor(async () => expect(await labelsOf()).toBeDefined(), SETTLE);

    await port.addLabel(issue, "friday-live");
    await port.addLabel(issue, "friday-live");
    await vi.waitFor(
      async () => expect((await labelsOf())?.filter((l) => l === "friday-live")).toHaveLength(1),
      SETTLE,
    );
    await port.removeLabel(issue, "friday-live");
    await port.removeLabel(issue, "friday-live");
    await vi.waitFor(async () => expect(await labelsOf()).not.toContain("friday-live"), SETTLE);

    expect(await port.postAgentComment(issue, "qa", "teste vivo")).toEqual({ created: true });
    await vi.waitFor(async () => {
      const comments = await octokit.request(
        "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
        { ...repo, issue_number: issue },
      );
      expect(comments.data).toHaveLength(1);
    }, SETTLE);
    expect(await port.postAgentComment(issue, "qa", "teste vivo")).toEqual({ created: false });

    await createBranchWithFile(octokit);
    const input = { head: branch, base: "develop", title: `Teste vivo ${stamp}`, body: "#122" };
    const pr = await port.createPullRequest(input);
    expect(pr.created).toBe(true);
    await vi.waitFor(async () => {
      const again = await port.createPullRequest(input);
      expect(again).toEqual({ number: pr.number, headSha: pr.headSha, created: false });
    }, SETTLE);

    const ci = await port.getCiStatus(pr.number, "check");
    expect(ci.headSha).toBe(pr.headSha);
    expect(["missing", "pending", "success", "failure"]).toContain(ci.state);

    await vi.waitFor(async () => {
      const diff = await port.getPrDiff(pr.number);
      expect(diff.files).toEqual([{ path: `live/${stamp}.txt`, changedLines: 1, hasPatch: true }]);
      expect(diff.diffBytes).toBeGreaterThan(0);
    }, SETTLE);

    const review = await port.postReview(pr.number, {
      commitId: pr.headSha,
      body: "Teste vivo da #122.",
      event: "COMMENT",
    });
    expect(review.id).toBeGreaterThan(0);

    expect(await port.squashMerge(pr.number, "0".repeat(40))).toEqual({
      merged: false,
      reason: "head_changed",
    });
    const merged = await port.squashMerge(pr.number, pr.headSha);
    expect(merged.merged).toBe(true);
  });
});
