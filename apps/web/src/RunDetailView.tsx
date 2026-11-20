import type { HostEntry, RunItem, RunReview } from "@friday/contracts";
import { selectionToSearch } from "./host-selection.ts";
import { prUrl } from "./pr-link.ts";
import { runDetailMessage, type RunDetailState } from "./run-detail-state.ts";

const OUTCOMES = {
  approve: "Aprovado",
  reject: "Rejeitado",
  changes_requested: "Mudanças solicitadas",
} as const;

function Verdict({ judge }: { judge: RunReview["judge"] }) {
  if (judge === null) return <p data-field="judge">Sem veredito do Judge.</p>;
  return (
    <>
      <p data-field="judge">{OUTCOMES[judge.outcome]}</p>
      {judge.feedback !== null && judge.feedback !== "" && (
        <p data-field="feedback">{judge.feedback}</p>
      )}
    </>
  );
}

function PrLink({ project, pr }: { project: string; pr: RunReview["pr"] }) {
  if (pr === null) return <p data-field="pr">Sem PR.</p>;
  const text = `PR #${pr.number}`;
  const url = prUrl(project, pr.number);
  if (url === null) return <p data-field="pr">{text}</p>;
  return (
    <a data-field="pr" href={url} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  );
}

function Details({ project, run, review }: { project: string; run: RunItem; review: RunReview }) {
  const cost = run.costUsd === null ? "—" : `$${run.costUsd.toFixed(2)}`;
  const turns = run.numTurns === null ? "—" : String(run.numTurns);
  return (
    <>
      <p data-field="status">{run.status}</p>
      <p data-field="cost">{cost}</p>
      <p data-field="turns">{turns}</p>
      <Verdict judge={review.judge} />
      <PrLink project={project} pr={review.pr} />
    </>
  );
}

export function RunDetailView({
  host,
  project,
  runId,
  state,
  run,
  review,
}: {
  host: HostEntry;
  project: string;
  runId: string;
  state: RunDetailState;
  run: RunItem | null;
  review: RunReview | null;
}) {
  const message = runDetailMessage(state);
  return (
    <section data-view="run">
      <h2 data-field="run-title">{`Run ${runId} de ${project} em ${host.name}`}</h2>
      <a data-action="back" href={selectionToSearch(host.name, project)}>
        Voltar ao projeto
      </a>
      {message !== null && <p data-field="message">{message}</p>}
      {message === null && run !== null && review !== null && (
        <Details project={project} run={run} review={review} />
      )}
    </section>
  );
}
