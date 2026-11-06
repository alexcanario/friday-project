export interface GitHost {
  push(request: { worktree: string; branch: string; commit: string }): Promise<void>;
}
