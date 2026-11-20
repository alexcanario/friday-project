import type { DecisionResult } from "./api.ts";

const MESSAGES: Record<string, string> = {
  merged: "Aprovado e mesclado.",
  denied: "Pedido rejeitado.",
  head_changed: "O PR mudou depois do pedido; o merge foi recusado.",
  expired: "O pedido expirou.",
  already_decided: "O pedido já foi decidido.",
  merge_blocked: "O GitHub bloqueou o merge.",
  unknown: "Pedido não encontrado.",
};

export function decisionMessage(r: DecisionResult): string {
  if (r.outcome !== null && Object.hasOwn(MESSAGES, r.outcome))
    return MESSAGES[r.outcome] as string;
  if (r.outcome === null && r.status === 401) return "Token do painel inválido.";
  return `Falha inesperada (HTTP ${r.status}).`;
}
