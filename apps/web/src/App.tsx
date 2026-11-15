import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ApiClient } from "./api.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { displayState, type ConnectionState } from "./connection-state.ts";
import { queryKeys } from "./query-keys.ts";
import { useLiveEvents } from "./use-live-events.ts";

export function App({
  client,
  project,
  baseUrl = "",
}: {
  client: ApiClient;
  project?: string;
  baseUrl?: string;
}) {
  const query = useQuery({ queryKey: queryKeys.health, queryFn: () => client.fetchHealth() });
  const [live, setLive] = useState<ConnectionState | null>(null);
  useLiveEvents(baseUrl, project, setLive);
  return (
    <main>
      <h1>Friday</h1>
      <ConnectionStatus state={displayState(live, query.status)} />
    </main>
  );
}
