import type { StaleVerdicts } from "@friday/application";

/** Stale Judge verdicts of one experiment process, in memory (the eval database is temporary). */
export function createMemoryStaleVerdicts(): StaleVerdicts {
  const stale = new Set<string>();
  const keyOf = (projectId: string, issueId: number, headSha: string) =>
    JSON.stringify([projectId, issueId, headSha]);
  return {
    markStale(projectId, issueId, headSha) {
      stale.add(keyOf(projectId, issueId, headSha));
    },
    isStale(projectId, issueId, headSha) {
      return stale.has(keyOf(projectId, issueId, headSha));
    },
  };
}
