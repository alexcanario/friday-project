import type { HostEntry } from "@friday/contracts";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo, type FormEvent } from "react";
import type { ApiClient } from "./api.ts";
import { hostCardStateOf, type HostCardState, type ProjectSummary } from "./host-card-state.ts";
import { selectionToSearch } from "./host-selection.ts";
import { saveToken } from "./token.ts";
import { utcDay } from "./utc-day.ts";

const ENABLED = { true: "ligado", false: "desligado", null: "desconhecido" } as const;

export function saveHostToken(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  host: string,
  value: string,
): void {
  saveToken(host, value);
  void queryClient.invalidateQueries({ queryKey: ["overview", host] });
}

interface HostCardViewProps {
  host: HostEntry;
  state: HostCardState;
  onSaveToken: (host: string, value: string) => void;
}

function TokenForm({ host, onSaveToken }: Pick<HostCardViewProps, "host" | "onSaveToken">) {
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = new FormData(e.currentTarget).get("token");
    onSaveToken(host.name, typeof value === "string" ? value : "");
  };
  return (
    <form onSubmit={onSubmit}>
      <p>Token necessário</p>
      <input type="password" name="token" data-field="token" autoComplete="off" />
      <button type="submit" data-action="save-token">
        Salvar token
      </button>
    </form>
  );
}

function ProjectRow({ host, p }: { host: HostEntry; p: ProjectSummary }) {
  const enabled = ENABLED[String(p.enabled) as keyof typeof ENABLED];
  const breaker = p.breakerOpen ? "aberto" : "fechado";
  return (
    <li data-project={p.id}>
      <a data-project-link href={selectionToSearch(host.name, p.id)}>
        {p.id}
      </a>{" "}
      {`${enabled} · breaker ${breaker} · ${p.activeRuns} runs · $${p.dayCostUsd.toFixed(2)}`}
    </li>
  );
}

function Ready({ host, projects }: { host: HostEntry; projects: ProjectSummary[] }) {
  const open = projects.some((p) => p.breakerOpen);
  const runs = projects.reduce((n, p) => n + p.activeRuns, 0);
  const cost = projects.reduce((n, p) => n + p.dayCostUsd, 0);
  const partial = projects.some((p) => p.anyCostUnknown);
  return (
    <>
      <p>
        <span data-field="breaker">{open ? "aberto" : "fechado"}</span>{" "}
        <span data-field="active-runs">{String(runs)}</span>{" "}
        <span data-field="day-cost">{`$${cost.toFixed(2)}${partial ? " (parcial)" : ""}`}</span>
      </p>
      {projects.length === 0 ? (
        <p>Nenhum projeto.</p>
      ) : (
        <ul data-list="projects">
          {projects.map((p) => (
            <ProjectRow key={p.id} host={host} p={p} />
          ))}
        </ul>
      )}
    </>
  );
}

export function HostCardView({ host, state, onSaveToken }: HostCardViewProps) {
  return (
    <section data-host-card={host.name}>
      <h2>{host.name}</h2>
      {state.kind === "loading" && <p>Carregando</p>}
      {state.kind === "offline" && <p>sem conexão</p>}
      {state.kind === "error" && <p>Erro ao consultar o host</p>}
      {state.kind === "unauthorized" && <TokenForm host={host} onSaveToken={onSaveToken} />}
      {state.kind === "ready" && <Ready host={host} projects={state.projects} />}
    </section>
  );
}

export function HostCard({
  host,
  clientFor,
}: {
  host: HostEntry;
  clientFor: (host: HostEntry) => ApiClient;
}) {
  const client = useMemo(() => clientFor(host), [host, clientFor]);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["overview", host.name],
    retry: false,
    retryOnMount: false,
    queryFn: async (): Promise<ProjectSummary[]> => {
      const day = utcDay(Date.now());
      const projects = await client.fetchProjects();
      return Promise.all(
        projects.map(async (p) => ({
          id: p.id,
          ...(await client.fetchProjectOverview(p.id, day)),
        })),
      );
    },
  });
  return (
    <HostCardView
      host={host}
      state={hostCardStateOf(query)}
      onSaveToken={(name, value) => saveHostToken(queryClient, name, value)}
    />
  );
}
