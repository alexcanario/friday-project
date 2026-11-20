import type { HostEntry } from "@friday/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ApiClient } from "./api.ts";
import { defaultClientFor } from "./client-for.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { displayState, type ConnectionState } from "./connection-state.ts";
import { selectionFromSearch, type Selection } from "./host-selection.ts";
import { liveTarget } from "./live-target.ts";
import { Overview } from "./Overview.tsx";
import { ProjectScreen } from "./ProjectScreen.tsx";
import { queryKeys } from "./query-keys.ts";
import { RunDetailScreen } from "./RunDetailScreen.tsx";
import { useLiveEvents } from "./use-live-events.ts";

function Hosts({
  hosts,
  selection,
  clientFor,
}: {
  hosts: HostEntry[] | null;
  selection: Selection;
  clientFor: (host: HostEntry) => ApiClient;
}) {
  if (hosts === null) return <p data-field="error">Não foi possível ler a lista de hosts.</p>;
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
  hosts,
  search = "",
  clientFor = defaultClientFor,
}: {
  client: ApiClient;
  hosts?: HostEntry[] | null;
  search?: string;
  clientFor?: (host: HostEntry) => ApiClient;
}) {
  const query = useQuery({ queryKey: queryKeys.health, queryFn: () => client.fetchHealth() });
  const [live, setLive] = useState<ConnectionState | null>(null);
  const selection: Selection = Array.isArray(hosts)
    ? selectionFromSearch(search, hosts)
    : { kind: "none" };
  const target = liveTarget(selection);
  useLiveEvents(target?.baseUrl ?? "", target?.project, setLive, target?.token, target?.host);
  return (
    <main>
      <h1>Friday</h1>
      <ConnectionStatus state={displayState(live, query.status, target !== null)} />
      {hosts !== undefined && <Hosts hosts={hosts} selection={selection} clientFor={clientFor} />}
    </main>
  );
}
