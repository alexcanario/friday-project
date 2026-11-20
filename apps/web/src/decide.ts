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
  await refreshHostData(queryClient, project, host);
  return message;
}

/** Invalidates the exact keys of one host and project; never the `issues(project)` prefix. */
export async function refreshHostData(
  queryClient: QueryClient,
  project: string,
  host: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.approvals(project, host) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.status(project, host) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.projectIssues(project, host) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.projectRuns(project, host) }),
  ]);
}

/** Runs `task` unless the lock is taken (then null); releases the lock even if `task` rejects. */
export async function runExclusive(
  lock: { current: boolean },
  task: () => Promise<string>,
): Promise<string | null> {
  if (lock.current) return null;
  lock.current = true;
  try {
    return await task();
  } finally {
    lock.current = false;
  }
}
