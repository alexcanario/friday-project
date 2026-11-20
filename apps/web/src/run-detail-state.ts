import {
  ApiHttpError,
  ApiRedirectError,
  LOGIN_EXPIRED_MESSAGE,
  classifyHostError,
} from "./api-errors.ts";
import type { QueryPart } from "./project-state.ts";

export type RunDetailState =
  "loading" | "offline" | "unauthorized" | "login" | "not-found" | "error" | "ready";

function kindOf(part: QueryPart): Exclude<RunDetailState, "loading" | "ready"> {
  const e = part.error;
  if (e instanceof ApiHttpError && !(e instanceof ApiRedirectError) && e.status === 404) {
    return "not-found";
  }
  return classifyHostError(part.error);
}

export function runDetailState(run: QueryPart, review: QueryPart): RunDetailState {
  const kinds = [run, review].filter((p) => p.status === "error").map(kindOf);
  for (const kind of ["unauthorized", "login", "offline", "not-found", "error"] as const) {
    if (kinds.includes(kind)) return kind;
  }
  if (run.status === "pending" || review.status === "pending") return "loading";
  return "ready";
}

const MESSAGES: Record<Exclude<RunDetailState, "ready">, string> = {
  loading: "Carregando a run...",
  offline: "Sem conexão com o host.",
  unauthorized: "Token necessário. Informe o token do host na visão geral.",
  login: LOGIN_EXPIRED_MESSAGE,
  "not-found": "Esta run não foi encontrada.",
  error: "Não foi possível carregar a run.",
};

export function runDetailMessage(state: RunDetailState): string | null {
  return state === "ready" ? null : MESSAGES[state];
}
