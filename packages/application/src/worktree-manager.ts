import type { Result } from "@friday/domain";

export type WorktreeErrorCode =
  "WorktreeExists" | "WorktreeCreateFailed" | "WorktreeRemoveFailed" | "InvalidPath";

export interface WorktreeError {
  code: WorktreeErrorCode;
  message: string;
}

export interface WorktreeInfo {
  issue: number;
  path: string;
  head: string;
}

export interface WorktreeProject {
  root: string;
  project: string;
}

export interface CreateWorktreeRequest extends WorktreeProject {
  issue: number;
  title: string;
  base: string;
}

export interface WorktreeManager {
  create(request: CreateWorktreeRequest): Promise<Result<{ path: string }, WorktreeError>>;
  remove(request: WorktreeProject & { issue: number }): Promise<Result<void, WorktreeError>>;
  list(request: WorktreeProject): Promise<Result<WorktreeInfo[], WorktreeError>>;
  /** Worktrees whose issue is not in `activeIssues`; the port never reads the database. */
  listOrphans(
    request: WorktreeProject & { activeIssues: number[] },
  ): Promise<Result<WorktreeInfo[], WorktreeError>>;
  /** True when the tree has no changes, untracked files included, and `head` resolves to the commit at `HEAD`. */
  isClean(path: string, head: string): Promise<boolean>;
  /** Moves a clean worktree to the commit `sha` (40 lowercase hex) of the remote, detached; refuses a dirty tree. */
  alignTo(path: string, sha: string): Promise<Result<void, WorktreeError>>;
}
