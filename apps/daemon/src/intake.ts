import type {
  EventStore,
  GitHubPort,
  IssueRepository,
  StateChangedPayload,
} from "@friday/application";

export interface IntakeDeps {
  projectId: string;
  github: Pick<GitHubPort, "listIssuesByLabel">;
  issues: IssueRepository;
  events: EventStore;
  now: () => Date;
  log?: (message: string) => void;
}

export interface Intake {
  /** Ingests issues labeled `friday` that have no row; returns their numbers in GitHub order. */
  ingest(): Promise<number[]>;
}

const INTAKE_LABEL = "friday";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function admittedPayload(number: number): StateChangedPayload {
  return {
    type: "StateChanged",
    issueId: String(number),
    from: "Backlog",
    to: "Todo",
    trigger: "Admitted",
    heldReason: null,
    verifyRound: 0,
    qaRound: 0,
    reviewIter: 0,
  };
}

type IngestDeps = Pick<IntakeDeps, "projectId" | "issues" | "events" | "now">;
type ListedIssue = { number: number; title: string; body: string; labels: string[] };

/** Resumes after a partial failure: only writes the events and rebuild that are still missing. */
function ingestOne({ projectId, issues, events, now }: IngestDeps, issue: ListedIssue): boolean {
  if (issues.get(projectId, issue.number) !== null) return false;
  const at = now().toISOString();
  const base = { projectId, issueId: issue.number, runId: null, actor: "daemon", at };
  const existing = events.list(projectId, issue.number);
  if (!existing.some((e) => e.type === "IssueIngested")) {
    const { number, title, body, labels } = issue;
    events.append({ ...base, type: "IssueIngested", payload: { number, title, body, labels } });
  }
  const admitted = existing.some(
    (e) => e.type === "StateChanged" && (e.payload as { trigger?: unknown }).trigger === "Admitted",
  );
  if (!admitted) {
    events.append({ ...base, type: "StateChanged", payload: admittedPayload(issue.number) });
  }
  issues.rebuild(projectId);
  return true;
}

export function createIntake(deps: IntakeDeps): Intake {
  const { github } = deps;
  const log = deps.log ?? (() => undefined);

  return {
    async ingest() {
      let listed;
      try {
        listed = await github.listIssuesByLabel(INTAKE_LABEL);
      } catch (error) {
        log(`Failed to list issues: ${messageOf(error)}`);
        return [];
      }
      const ingested: number[] = [];
      for (const issue of listed) {
        try {
          if (ingestOne(deps, issue)) ingested.push(issue.number);
        } catch (error) {
          log(`Failed to ingest issue ${issue.number}: ${messageOf(error)}`);
        }
      }
      return ingested;
    },
  };
}
