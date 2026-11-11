import type {
  CiStatus,
  CreatedPr,
  GitHubPort,
  IssueSummary,
  MergeResult,
  PrDiff,
  PrReviewDiff,
  PrMergeState,
  ReviewEvent,
} from "@friday/application";
import { PrDiffTruncatedError } from "@friday/application";
import type { Octokit } from "octokit";
import { toPrReviewDiff } from "./pr-review-diff.ts";

type Repo = { owner: string; repo: string };

const ROLE_PATTERN = /^[a-z][a-z0-9-]*$/;

export class GitHubRestAdapter implements GitHubPort {
  private readonly octokit: Octokit;
  private readonly repo: Repo;

  constructor(octokit: Octokit, repo: Repo) {
    this.octokit = octokit;
    this.repo = repo;
  }

  async listIssuesByLabel(label: string): Promise<IssueSummary[]> {
    const items = await this.octokit.paginate("GET /repos/{owner}/{repo}/issues", {
      ...this.repo,
      labels: label,
      state: "open",
      per_page: 100,
    });
    return items
      .filter((item) => !("pull_request" in item))
      .map((item) => ({
        number: item.number,
        title: item.title,
        body: item.body ?? "",
        labels: item.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
      }));
  }

  async addLabel(issue: number, label: string): Promise<void> {
    if ((await this.labelNames(issue)).includes(label)) return;
    await this.octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/labels", {
      ...this.repo,
      issue_number: issue,
      labels: [label],
    });
  }

  async removeLabel(issue: number, label: string): Promise<void> {
    if (!(await this.labelNames(issue)).includes(label)) return;
    await this.octokit.request("DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}", {
      ...this.repo,
      issue_number: issue,
      name: label,
    });
  }

  async postAgentComment(issue: number, role: string, text: string): Promise<{ created: boolean }> {
    if (!ROLE_PATTERN.test(role)) throw new Error(`papel inválido: ${role}`);
    const body = `agent:${role}: ${text}`;
    const comments = await this.octokit.paginate(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
      { ...this.repo, issue_number: issue, per_page: 100 },
    );
    if (comments.some((c) => c.body === body)) return { created: false };
    await this.octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
      ...this.repo,
      issue_number: issue,
      body,
    });
    return { created: true };
  }

  async createPullRequest(input: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<CreatedPr> {
    const open = await this.octokit.request("GET /repos/{owner}/{repo}/pulls", {
      ...this.repo,
      head: `${this.repo.owner}:${input.head}`,
      base: input.base,
      state: "open",
    });
    const existing = open.data[0];
    if (existing) return { number: existing.number, headSha: existing.head.sha, created: false };
    const made = await this.octokit.request("POST /repos/{owner}/{repo}/pulls", {
      ...this.repo,
      ...input,
    });
    return { number: made.data.number, headSha: made.data.head.sha, created: true };
  }

  async getCiStatus(pr: number, checkName: string): Promise<CiStatus> {
    const headSha = await this.headSha(pr);
    const runs = await this.octokit
      .paginate("GET /repos/{owner}/{repo}/commits/{ref}/check-runs", {
        ...this.repo,
        ref: headSha,
        per_page: 100,
      })
      .catch((error: unknown) => {
        throw isFineGrainedTokenError(error) ? fineGrainedTokenError(error) : error;
      });
    const latest = runs
      .filter((r) => r.name === checkName)
      .reduce<(typeof runs)[number] | undefined>((a, r) => (a && a.id > r.id ? a : r), undefined);
    if (!latest) return { headSha, state: "missing" };
    if (latest.status !== "completed") return { headSha, state: "pending" };
    return { headSha, state: latest.conclusion === "success" ? "success" : "failure" };
  }

  private async changedFiles(pr: number): Promise<{ count: number; headSha: string }> {
    const res = await this.octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      ...this.repo,
      pull_number: pr,
    });
    return { count: res.data.changed_files, headSha: res.data.head.sha };
  }

  private async prFiles(pr: number) {
    const { count: expected, headSha } = await this.changedFiles(pr);
    const files = await this.octokit.paginate(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
      {
        ...this.repo,
        pull_number: pr,
        per_page: 100,
      },
    );
    // The route caps at 3000 files: an incomplete diff must never reach classifyRisk.
    if (files.length !== expected) throw new PrDiffTruncatedError(expected, files.length);
    return { files, headSha };
  }

  async getPrReviewDiff(pr: number): Promise<PrReviewDiff> {
    const { files, headSha } = await this.prFiles(pr);
    return toPrReviewDiff(headSha, files);
  }

  async getPrDiff(pr: number): Promise<PrDiff> {
    const { files } = await this.prFiles(pr);
    return {
      files: files.flatMap((f) => [
        {
          path: f.filename,
          changedLines: f.additions + f.deletions,
          hasPatch: f.patch !== undefined,
        },
        // A rename leaves its origin path too: gates must see protected paths moved away.
        ...(f.previous_filename === undefined
          ? []
          : [{ path: f.previous_filename, changedLines: 0, hasPatch: true }]),
      ]),
      diffBytes: files.reduce(
        (sum, f) => sum + (f.patch === undefined ? 0 : Buffer.byteLength(f.patch, "utf8")),
        0,
      ),
    };
  }

  async getPrMergeState(pr: number): Promise<PrMergeState> {
    const res = await this.octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      ...this.repo,
      pull_number: pr,
    });
    return { merged: res.data.merged, headSha: res.data.head.sha };
  }

  async squashMerge(pr: number, expectedHeadSha: string): Promise<MergeResult> {
    if ((await this.headSha(pr)) !== expectedHeadSha) {
      return { merged: false, reason: "head_changed" };
    }
    try {
      const res = await this.octokit.request(
        "PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge",
        {
          ...this.repo,
          pull_number: pr,
          merge_method: "squash",
          sha: expectedHeadSha,
          request: { retries: 0 },
        },
      );
      return { merged: true, sha: res.data.sha };
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 409) return { merged: false, reason: "head_changed" };
      if (status === 405) return { merged: false, reason: "not_mergeable" };
      throw error;
    }
  }

  async postReview(
    pr: number,
    review: { commitId: string; body: string; event: ReviewEvent },
  ): Promise<{ id: number }> {
    const res = await this.octokit.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      {
        ...this.repo,
        pull_number: pr,
        commit_id: review.commitId,
        body: review.body,
        event: review.event,
      },
    );
    return { id: Number(res.data.id) };
  }

  private async headSha(pr: number): Promise<string> {
    const res = await this.octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      ...this.repo,
      pull_number: pr,
    });
    return res.data.head.sha;
  }

  private async labelNames(issue: number): Promise<string[]> {
    const labels = await this.octokit.paginate(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/labels",
      { ...this.repo, issue_number: issue, per_page: 100 },
    );
    return labels.map((l) => l.name);
  }
}

const FINE_GRAINED_MARKER = "Resource not accessible by personal access token";

function isFineGrainedTokenError(error: unknown): boolean {
  const e = error as {
    status?: number;
    message?: string;
    response?: { data?: { message?: string } };
  };
  if (e?.status !== 403) return false;
  return (e.response?.data?.message ?? e.message ?? "").includes(FINE_GRAINED_MARKER);
}

function fineGrainedTokenError(cause: unknown): Error {
  return new Error(
    "A API de check runs recusou o token do autor: tokens fine-grained não têm acesso a ela. " +
      "Use um token de GitHub App ou um token clássico com escopo repo (veja docs/token-do-autor.md).",
    { cause },
  );
}
