import type { HostEntry } from "@friday/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ApiClient } from "./api.ts";
import { defaultClientFor } from "./client-for.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { displayState, type ConnectionState } from "./connection-state.ts";
import { selectionFromSearch } from "./host-selection.ts";
import { Overview } from "./Overview.tsx";
import { ProjectScreen } from "./ProjectScreen.tsx";
import { queryKeys } from "./query-keys.ts";
import { RunDetailScreen } from "./RunDetailScreen.tsx";
import { useLiveEvents } from "./use-live-events.ts";

function Hosts({
  hosts,
  search,
  clientFor,
}: {
  hosts: HostEntry[] | null;
  search: string;
  clientFor: (host: HostEntry) => ApiClient;
}) {
  if (hosts === null) return <p data-field="error">Não foi possível ler a lista de hosts.</p>;
  const selection = selectionFromSearch(search, hosts);
  if (selection.kind === "unknown-host") {
    return <p data-field="error">{`Host desconhecido: ${selection.host}.`}</p>;
  }
  if (selection.kind === "selected" && selection.run !== undefined) {
    return (
      <RunDetailScreen
        host={selection.host}
        project={selection.project}
        runId={selection.run}
        clientFor={clientFor}
      />
    );
  }
  if (selection.kind === "selected") {
    return (
      <ProjectScreen host={selection.host} project={selection.project} clientFor={clientFor} />
    );
  }
  return <Overview hosts={hosts} clientFor={clientFor} />;
}

export function App({
  client,
  project,
  baseUrl = "",
  hosts,
  search = "",
  clientFor = defaultClientFor,
}: {
  client: ApiClient;
  project?: string;
  baseUrl?: string;
  hosts?: HostEntry[] | null;
  search?: string;
  clientFor?: (host: HostEntry) => ApiClient;
}) {
  const query = useQuery({ queryKey: queryKeys.health, queryFn: () => client.fetchHealth() });
  const [live, setLive] = useState<ConnectionState | null>(null);
  useLiveEvents(baseUrl, project, setLive);
  return (
    <main>
      <h1>Friday</h1>
      <ConnectionStatus state={displayState(live, query.status)} />
      {hosts !== undefined && <Hosts hosts={hosts} search={search} clientFor={clientFor} />}
    </main>
  );
}
