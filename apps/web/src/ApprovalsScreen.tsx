import { useQuery, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useRef, useState } from "react";
import type { ApiClient } from "./api.ts";
import { ApprovalsView } from "./ApprovalsView.tsx";
import { decideAndRefresh, refreshHostData, runExclusive } from "./decide.ts";
import { queryKeys } from "./query-keys.ts";
import { readToken, saveTyped, submitToken } from "./token.ts";

export function approvalsMessage(state: "loading" | "error" | "ready"): string | null {
  if (state === "error") return "Não foi possível carregar as aprovações.";
  if (state === "loading") return "Carregando aprovações...";
  return null;
}

function TokenField(props: { onSave: (value: string) => void }): React.JSX.Element {
  const [typed, setTyped] = useState("");
  return (
    <div>
      <input
        type="password"
        data-field="token"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      <button onClick={() => setTyped(saveTyped(typed, props.onSave))}>Salvar token</button>
    </div>
  );
}

function useDecision(client: ApiClient, host: string, project: string) {
  const queryClient = useQueryClient();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const decide = (id: string, action: "approve" | "deny"): void => {
    setBusy(true);
    runExclusive(lock, () => decideAndRefresh(queryClient, client, host, project, id, action))
      .then((result) => (result === null ? undefined : setMessage(result)))
      .catch(() => setMessage("Não foi possível enviar a decisão."))
      .finally(() => setBusy(false));
  };
  return { busy, message, decide };
}

export function ApprovalsScreen(props: {
  client: ApiClient;
  host: string;
  project: string;
}): React.JSX.Element {
  const { client, host, project } = props;
  const queryClient = useQueryClient();
  const approvals = useQuery({
    queryKey: queryKeys.approvals(project, host),
    queryFn: () => client.fetchApprovals(project),
  });
  const status = useQuery({
    queryKey: queryKeys.status(project, host),
    queryFn: () => client.fetchStatus(project),
  });
  const [hasToken, setHasToken] = useState(readToken(host) !== "");
  const { busy, message, decide } = useDecision(client, host, project);
  const state =
    approvals.isError || status.isError
      ? "error"
      : approvals.data && status.data
        ? "ready"
        : "loading";
  const text = approvalsMessage(state);
  const onSave = (value: string): void => {
    setHasToken(submitToken(host, value));
    void refreshHostData(queryClient, project, host);
  };
  return (
    <section>
      <TokenField onSave={onSave} />
      {text !== null ? <p>{text}</p> : null}
      {approvals.data && status.data ? (
        <ApprovalsView
          approvals={approvals.data}
          status={status.data}
          hasToken={hasToken}
          busy={busy}
          message={message}
          onApprove={(id) => decide(id, "approve")}
          onDeny={(id) => decide(id, "deny")}
        />
      ) : null}
    </section>
  );
}
