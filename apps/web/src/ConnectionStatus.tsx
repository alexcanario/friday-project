import type { ConnectionState } from "./connection-state.ts";

const LABELS: Record<ConnectionState, string> = {
  loading: "Carregando…",
  connected: "Conectado",
  offline: "Sem conexão",
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  return <p data-state={state}>{LABELS[state]}</p>;
}
