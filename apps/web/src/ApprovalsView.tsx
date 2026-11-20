import type { ApprovalItem, StatusResponse } from "@friday/contracts";
import type React from "react";

export interface ApprovalsViewProps {
  approvals: ApprovalItem[];
  status: StatusResponse;
  hasToken: boolean;
  message: string | null;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}

function enabledText(enabled: boolean | null): string {
  if (enabled === null) return "desconhecido";
  return enabled ? "ligado" : "desligado";
}

export function ApprovalsView(props: ApprovalsViewProps): React.JSX.Element {
  const { approvals, status, hasToken, message, onApprove, onDeny } = props;
  return (
    <div>
      {message === null ? null : <p data-field="message">{message}</p>}
      {approvals.length === 0 ? <p>Nenhum pedido pendente.</p> : null}
      <ul data-list="approvals">
        {approvals.map((a) => (
          <li key={a.id} data-approval-id={a.id}>
            <span>{`#${a.issueId}`}</span> <span>{`PR #${a.pr}`}</span>{" "}
            <span data-field="head-sha">{a.headSha}</span> <span data-field="tier">{a.tier}</span>{" "}
            <button data-action="approve" disabled={!hasToken} onClick={() => onApprove(a.id)}>
              Aprovar
            </button>
            <button data-action="deny" disabled={!hasToken} onClick={() => onDeny(a.id)}>
              Rejeitar
            </button>
          </li>
        ))}
      </ul>
      <section data-section="status">
        <p>
          Interruptor: <span data-field="enabled">{enabledText(status.enabled)}</span>
        </p>
        <p>
          Breaker: <span data-field="breaker">{status.breaker.open ? "aberto" : "fechado"}</span>
        </p>
        <p>
          Aberto em: <span data-field="opened-at">{status.breaker.openedAt ?? "—"}</span>
        </p>
        <ul data-list="failures">
          {status.breaker.failures.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
