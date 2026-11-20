import {
  approvalItem,
  daySum,
  healthResponse,
  issueItem,
  projectItem,
  runItem,
  statusResponse,
  type ApprovalItem,
  type HealthResponse,
  type IssueItem,
  type ProjectItem,
  type RunItem,
  type StatusResponse,
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
  fetchApprovals(project: string): Promise<ApprovalItem[]>;
  fetchStatus(project: string): Promise<StatusResponse>;
  postDecision(id: string, action: "approve" | "deny"): Promise<DecisionResult>;
}

export interface DecisionResult {
  status: number;
  outcome: string | null;
}

async function postDecision(
  base: string,
  id: string,
  action: "approve" | "deny",
  getToken?: () => string,
): Promise<DecisionResult> {
  const token = getToken?.() ?? "";
  const headers: Record<string, string> = token === "" ? {} : { "x-friday-token": token };
  const url = `${base}/approvals/${encodeURIComponent(id)}/${action}`;
  const res = await fetch(url, { method: "POST", headers });
  let outcome: string | null = null;
  try {
    const body: unknown = await res.json();
    const value = (body as { outcome?: unknown } | null)?.outcome;
    if (typeof value === "string") outcome = value;
  } catch {
    outcome = null;
  }
  return { status: res.status, outcome };
}

type Get = (path: string) => Promise<unknown>;

function approvalMethods(
  base: string,
  get: Get,
  getToken?: () => string,
): Pick<ApiClient, "fetchApprovals" | "fetchStatus" | "postDecision"> {
  return {
    async fetchApprovals(project) {
      const q = encodeURIComponent(project);
      return approvalItem.array().parse(await get(`/approvals?project=${q}`));
    },
    async fetchStatus(project) {
      return statusResponse.parse(await get(`/status?project=${encodeURIComponent(project)}`));
    },
    postDecision(id, action) {
      return postDecision(base, id, action, getToken);
    },
  };
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
    ...approvalMethods(base, get, getToken),
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
