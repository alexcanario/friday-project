export const queryKeys = {
  health: ["health"] as const,
  issues: (project: string) => ["issues", project] as const,
  issue: (project: string, issueId: number) => ["issues", project, issueId] as const,
  approvals: (project: string) => ["approvals", project] as const,
  status: (project: string) => ["status", project] as const,
  // Both list keys start with `issues(project)`, the key the live stream invalidates.
  projectIssues: (project: string, host: string) => ["issues", project, "list", host] as const,
  projectRuns: (project: string, host: string) => ["issues", project, "runs", host] as const,
};
