import { useQuery, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useState } from "react";
import type { ApiClient } from "./api.ts";
import { ApprovalsView } from "./ApprovalsView.tsx";
import { decideAndRefresh } from "./decide.ts";
import { queryKeys } from "./query-keys.ts";
import { readToken, submitToken } from "./token.ts";

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
      <button onClick={() => props.onSave(typed)}>Salvar token</button>
    </div>
  );
}

export function ApprovalsScreen(props: {
  client: ApiClient;
  host: string;
  project: string;
}): React.JSX.Element {
  const { client, host, project } = props;
  const queryClient = useQueryClient();
  const approvals = useQuery({
    queryKey: queryKeys.approvals(project),
    queryFn: () => client.fetchApprovals(project),
  });
  const status = useQuery({
    queryKey: queryKeys.status(project),
    queryFn: () => client.fetchStatus(project),
  });
  const [hasToken, setHasToken] = useState(readToken(host) !== "");
  const [message, setMessage] = useState<string | null>(null);
  const decide = (id: string, action: "approve" | "deny"): void => {
    void decideAndRefresh(queryClient, client, host, project, id, action).then(setMessage);
  };
  const state =
    approvals.isError || status.isError
      ? "error"
      : approvals.data && status.data
        ? "ready"
        : "loading";
  const text = approvalsMessage(state);
  return (
    <section>
      <TokenField onSave={(value) => setHasToken(submitToken(host, value))} />
      {text !== null ? <p>{text}</p> : null}
      {approvals.data && status.data ? (
        <ApprovalsView
          approvals={approvals.data}
          status={status.data}
          hasToken={hasToken}
          message={message}
          onApprove={(id) => decide(id, "approve")}
          onDeny={(id) => decide(id, "deny")}
        />
      ) : null}
    </section>
  );
}
