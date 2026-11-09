export interface GitHost {
  /** Commits the worktree changes (if any) as friday-author, pushes, and returns the commit SHA. */
  push(request: { worktree: string; branch: string; message: string }): Promise<{ sha: string }>;
}
