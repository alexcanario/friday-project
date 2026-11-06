export interface StaleVerdicts {
  markStale(projectId: string, issueId: number, headSha: string): void;
  isStale(projectId: string, issueId: number, headSha: string): boolean;
}
