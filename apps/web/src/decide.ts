import type { QueryClient } from "@tanstack/react-query";
import type { ApiClient } from "./api.ts";
import { decisionMessage } from "./decision-message.ts";
import { queryKeys } from "./query-keys.ts";
import { readToken } from "./token.ts";

export async function runDecision(
  client: ApiClient,
  host: string,
  id: string,
  action: "approve" | "deny",
): Promise<string> {
  if (readToken(host) === "") return "Token do painel inválido.";
  try {
    return decisionMessage(await client.postDecision(id, action));
  } catch {
    return "Não foi possível enviar a decisão.";
  }
}

export async function decideAndRefresh(
  queryClient: QueryClient,
  client: ApiClient,
  host: string,
  project: string,
  id: string,
  action: "approve" | "deny",
): Promise<string> {
  const message = await runDecision(client, host, id, action);
  await queryClient.invalidateQueries({ queryKey: queryKeys.approvals(project) });
  return message;
}
