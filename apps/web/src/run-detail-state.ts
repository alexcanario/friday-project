import { ApiHttpError, classifyHostError } from "./api-errors.ts";
import type { QueryPart } from "./project-state.ts";

export type RunDetailState =
  "loading" | "offline" | "unauthorized" | "not-found" | "error" | "ready";

function kindOf(part: QueryPart): "unauthorized" | "offline" | "not-found" | "error" {
  if (part.error instanceof ApiHttpError && part.error.status === 404) return "not-found";
  return classifyHostError(part.error);
}

export function runDetailState(run: QueryPart, review: QueryPart): RunDetailState {
  const kinds = [run, review].filter((p) => p.status === "error").map(kindOf);
  for (const kind of ["unauthorized", "offline", "not-found", "error"] as const) {
    if (kinds.includes(kind)) return kind;
  }
  if (run.status === "pending" || review.status === "pending") return "loading";
  return "ready";
}

const MESSAGES: Record<Exclude<RunDetailState, "ready">, string> = {
  loading: "Carregando a run...",
  offline: "Sem conexão com o host.",
  unauthorized: "Token necessário. Informe o token do host na visão geral.",
  "not-found": "Esta run não foi encontrada.",
  error: "Não foi possível carregar a run.",
};

export function runDetailMessage(state: RunDetailState): string | null {
  return state === "ready" ? null : MESSAGES[state];
}
