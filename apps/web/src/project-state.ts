import { classifyHostError } from "./api-errors.ts";

export type ProjectState = "loading" | "offline" | "unauthorized" | "error" | "ready";

export type QueryPart = { status: "pending" | "error" | "success"; error?: unknown };

export function projectStateOf(issues: QueryPart, runs: QueryPart): ProjectState {
  const failed = [issues, runs].filter((p) => p.status === "error");
  const kinds = failed.map((p) => classifyHostError(p.error));
  if (kinds.includes("unauthorized")) return "unauthorized";
  if (kinds.includes("offline")) return "offline";
  if (kinds.length > 0) return "error";
  if (issues.status === "pending" || runs.status === "pending") return "loading";
  return "ready";
}

const MESSAGES: Record<Exclude<ProjectState, "ready">, string> = {
  loading: "Carregando issues e runs...",
  offline: "Sem conexão com o host.",
  unauthorized: "Token necessário. Informe o token do host na visão geral.",
  error: "Não foi possível carregar issues e runs.",
};

export function projectMessage(state: ProjectState): string | null {
  return state === "ready" ? null : MESSAGES[state];
}
