import {
  daySum,
  healthResponse,
  issueItem,
  projectItem,
  runItem,
  statusResponse,
  type HealthResponse,
  type IssueItem,
  type ProjectItem,
  type RunItem,
} from "@friday/contracts";
import { ApiHttpError } from "./api-errors.ts";

export interface ProjectOverview {
  enabled: boolean | null;
  breakerOpen: boolean;
  activeRuns: number;
  dayCostUsd: number;
  anyCostUnknown: boolean;
}

export interface ApiClient {
  fetchHealth(): Promise<HealthResponse>;
  fetchProjects(): Promise<ProjectItem[]>;
  fetchProjectOverview(project: string, day: string): Promise<ProjectOverview>;
  fetchIssues(project: string): Promise<IssueItem[]>;
  fetchRuns(project: string): Promise<RunItem[]>;
}

/** Builds the API client for one base URL; `""` means the same origin as the page. */
export function createApiClient(baseUrl: string, getToken?: () => string): ApiClient {
  const base = baseUrl.replace(/\/+$/, "");

  async function get(path: string): Promise<unknown> {
    const token = getToken?.() ?? "";
    const res = await (token === ""
      ? fetch(`${base}${path}`)
      : fetch(`${base}${path}`, { headers: { "x-friday-token": token } }));
    if (!res.ok) throw new ApiHttpError(res.status);
    return res.json();
  }

  return {
    async fetchHealth() {
      return healthResponse.parse(await get("/health"));
    },
    async fetchProjects() {
      return projectItem.array().parse(await get("/projects"));
    },
    async fetchIssues(project) {
      return issueItem.array().parse(await get(`/issues?project=${encodeURIComponent(project)}`));
    },
    async fetchRuns(project) {
      return runItem.array().parse(await get(`/runs?project=${encodeURIComponent(project)}`));
    },
    async fetchProjectOverview(project, day) {
      const q = `project=${encodeURIComponent(project)}`;
      const [status, runs, sum] = await Promise.all([
        get(`/status?${q}`),
        get(`/runs?${q}`),
        get(`/ledger/days/${day}?${q}`),
      ]);
      const s = statusResponse.parse(status);
      const d = daySum.parse(sum);
      const active = runItem
        .array()
        .parse(runs)
        .filter((r) => r.status === "running" && r.finishedAt === null).length;
      return {
        enabled: s.enabled,
        breakerOpen: s.breaker.open,
        activeRuns: active,
        dayCostUsd: d.costUsd,
        anyCostUnknown: d.anyCostUnknown,
      };
    },
  };
}
