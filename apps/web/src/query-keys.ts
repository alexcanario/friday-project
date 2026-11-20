export const queryKeys = {
  health: ["health"] as const,
  issues: (project: string) => ["issues", project] as const,
  issue: (project: string, issueId: number) => ["issues", project, issueId] as const,
  approvals: (project: string) => ["approvals", project] as const,
  status: (project: string) => ["status", project] as const,
};
