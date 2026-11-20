export const queryKeys = {
  health: ["health"] as const,
  issues: (project: string) => ["issues", project] as const,
  issue: (project: string, issueId: number) => ["issues", project, issueId] as const,
  approvals: (project: string, host: string) => ["approvals", project, host] as const,
  status: (project: string, host: string) => ["status", project, host] as const,
  // Both list keys start with `issues(project)`, the key the live stream invalidates.
  projectIssues: (project: string, host: string) => ["issues", project, "list", host] as const,
  projectRuns: (project: string, host: string) => ["issues", project, "runs", host] as const,
  projectRun: (project: string, runId: string, host: string) =>
    ["issues", project, "run", runId, host] as const,
  projectRunReview: (project: string, runId: string, host: string) =>
    ["issues", project, "run-review", runId, host] as const,
};
