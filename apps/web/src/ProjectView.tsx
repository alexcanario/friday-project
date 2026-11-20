import type { HostEntry, IssueItem, RunItem } from "@friday/contracts";
import type { ReactNode } from "react";
import { runToSearch } from "./host-selection.ts";
import { projectMessage, type ProjectState } from "./project-state.ts";

function IssueRow({ issue }: { issue: IssueItem }) {
  return (
    <li data-issue-id={issue.issueId}>
      <span data-field="id">{`#${issue.issueId}`}</span>{" "}
      <span data-field="state">{issue.state}</span>
      {issue.heldReason !== null && (
        <>
          {" "}
          <span data-field="held-reason">{issue.heldReason}</span>
        </>
      )}
    </li>
  );
}

function RunRow({ host, project, run }: { host: HostEntry; project: string; run: RunItem }) {
  const cost = run.costUsd === null ? "—" : `$${run.costUsd.toFixed(2)}`;
  const turns = run.numTurns === null ? "—" : String(run.numTurns);
  return (
    <li data-run-id={run.id}>
      <a data-action="open-run" href={runToSearch(host.name, project, run.id)}>
        <span data-field="id">{`#${run.issueId}`}</span>
      </a>{" "}
      <span data-field="phase">{run.phase ?? "—"}</span>{" "}
      <span data-field="status">{run.status}</span> <span data-field="cost">{cost}</span>{" "}
      <span data-field="turns">{turns}</span>
    </li>
  );
}

function Lists(props: { host: HostEntry; project: string; issues: IssueItem[]; runs: RunItem[] }) {
  const { host, project, issues, runs } = props;
  const sorted = [...issues].sort((a, b) => a.issueId - b.issueId);
  return (
    <>
      {sorted.length === 0 ? (
        <p>Nenhuma issue.</p>
      ) : (
        <ul data-list="issues">
          {sorted.map((i) => (
            <IssueRow key={i.issueId} issue={i} />
          ))}
        </ul>
      )}
      {runs.length === 0 ? (
        <p>Nenhuma run.</p>
      ) : (
        <ul data-list="runs">
          {runs.map((r) => (
            <RunRow key={r.id} host={host} project={project} run={r} />
          ))}
        </ul>
      )}
    </>
  );
}

export function ProjectScreenView({
  host,
  project,
  state,
  issues,
  runs,
  approvals,
}: {
  host: HostEntry;
  project: string;
  state: ProjectState;
  issues: IssueItem[];
  runs: RunItem[];
  approvals?: ReactNode;
}) {
  const message = projectMessage(state);
  return (
    <section data-view="project">
      <h2 data-field="project-title">{`Projeto ${project} em ${host.name}`}</h2>
      <a data-action="back" href="?">
        Voltar à visão geral
      </a>
      {message !== null ? (
        <p data-field="message">{message}</p>
      ) : (
        <Lists host={host} project={project} issues={issues} runs={runs} />
      )}
      <section data-slot="approvals">{approvals}</section>
    </section>
  );
}
