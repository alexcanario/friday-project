export const queryKeys = {
  health: ["health"] as const,
  issues: (project: string) => ["issues", project] as const,
  issue: (project: string, issueId: number) => ["issues", project, issueId] as const,
};
