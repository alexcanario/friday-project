import type { ProjectOverview } from "./api.ts";
import { classifyHostError } from "./api-errors.ts";

export type ProjectSummary = { id: string } & ProjectOverview;

export type HostCardState =
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "error" }
  | { kind: "unauthorized" }
  | { kind: "ready"; projects: ProjectSummary[] };

export function hostCardStateOf(q: {
  status: "pending" | "error" | "success";
  data?: ProjectSummary[];
  error?: unknown;
}): HostCardState {
  if (q.status === "success" && q.data !== undefined) return { kind: "ready", projects: q.data };
  if (q.status === "error") return { kind: classifyHostError(q.error) };
  return { kind: "loading" };
}
