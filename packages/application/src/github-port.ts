import type { PrDiff } from "./pr-diff.ts";

export type IssueSummary = { number: number; title: string; body: string; labels: string[] };
export type CiState = "success" | "failure" | "pending" | "missing";
export type CiStatus = { headSha: string; state: CiState };
export type CreatedPr = { number: number; headSha: string; created: boolean };
export type MergeResult =
  { merged: true; sha: string } | { merged: false; reason: "head_changed" | "not_mergeable" };

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface GitHubPort {
  listIssuesByLabel(label: string): Promise<IssueSummary[]>;
  addLabel(issue: number, label: string): Promise<void>;
  removeLabel(issue: number, label: string): Promise<void>;
  postAgentComment(issue: number, role: string, text: string): Promise<{ created: boolean }>;
  createPullRequest(input: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<CreatedPr>;
  getCiStatus(pr: number, checkName: string): Promise<CiStatus>;
  getPrDiff(pr: number): Promise<PrDiff>;
  squashMerge(pr: number, expectedHeadSha: string): Promise<MergeResult>;
  postReview(
    pr: number,
    review: { commitId: string; body: string; event: ReviewEvent },
  ): Promise<{ id: number }>;
}
