import {
  approvalItem,
  daySum,
  healthResponse,
  projectItem,
  runItem,
  statusResponse,
  type ApprovalItem,
  type HealthResponse,
  type ProjectItem,
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
  fetchApprovals(project: string): Promise<ApprovalItem[]>;
  fetchStatus(project: string): Promise<StatusResponse>;
  postDecision(id: string, action: "approve" | "deny"): Promise<DecisionResult>;
}

export interface DecisionResult {
  status: number;
  outcome: string | null;
}

function authHeaders(getToken?: () => string): Record<string, string> {
  const token = getToken?.() ?? "";
  return token === "" ? {} : { "x-friday-token": token };
}

async function get(base: string, path: string, getToken?: () => string): Promise<unknown> {
  const headers = authHeaders(getToken);
  const url = `${base}${path}`;
  const res = await (Object.keys(headers).length === 0 ? fetch(url) : fetch(url, { headers }));
  if (!res.ok) throw new ApiHttpError(res.status);
  return res.json();
}

async function postDecision(
  base: string,
  id: string,
  action: "approve" | "deny",
  getToken?: () => string,
): Promise<DecisionResult> {
  const url = `${base}/approvals/${encodeURIComponent(id)}/${action}`;
  const res = await fetch(url, { method: "POST", headers: authHeaders(getToken) });
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

/** Builds the API client for one base URL; `""` means the same origin as the page. */
export function createApiClient(baseUrl: string, getToken?: () => string): ApiClient {
  const base = baseUrl.replace(/\/+$/, "");
  const get_ = (path: string) => get(base, path, getToken);

  return {
    async fetchHealth() {
      return healthResponse.parse(await get_("/health"));
    },
    async fetchProjects() {
      return projectItem.array().parse(await get_("/projects"));
    },
    async fetchApprovals(project) {
      const q = encodeURIComponent(project);
      return approvalItem.array().parse(await get_(`/approvals?project=${q}`));
    },
    async fetchStatus(project) {
      return statusResponse.parse(await get_(`/status?project=${encodeURIComponent(project)}`));
    },
    postDecision(id, action) {
      return postDecision(base, id, action, getToken);
    },
    async fetchProjectOverview(project, day) {
      const q = `project=${encodeURIComponent(project)}`;
      const [status, runs, sum] = await Promise.all([
        get_(`/status?${q}`),
        get_(`/runs?${q}`),
        get_(`/ledger/days/${day}?${q}`),
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
