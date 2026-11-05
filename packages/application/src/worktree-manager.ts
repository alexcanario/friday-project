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
  /** True when the tree has no changes and `HEAD` starts with `head`. */
  isClean(path: string, head: string): Promise<boolean>;
}
