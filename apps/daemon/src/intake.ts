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

export function createIntake(deps: IntakeDeps): Intake {
  const { projectId, github, issues, events, now } = deps;
  const log = deps.log ?? (() => undefined);

  function ingestOne(issue: { number: number; title: string; labels: string[] }): boolean {
    if (issues.get(projectId, issue.number) !== null) return false;
    const at = now().toISOString();
    const base = { projectId, issueId: issue.number, runId: null, actor: "daemon", at };
    events.append({
      ...base,
      type: "IssueIngested",
      payload: { number: issue.number, title: issue.title, labels: issue.labels },
    });
    const payload: StateChangedPayload = {
      type: "StateChanged",
      issueId: String(issue.number),
      from: "Backlog",
      to: "Todo",
      trigger: "Admitted",
      heldReason: null,
      verifyRound: 0,
      qaRound: 0,
      reviewIter: 0,
    };
    events.append({ ...base, type: "StateChanged", payload });
    issues.rebuild(projectId);
    return true;
  }

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
          if (ingestOne(issue)) ingested.push(issue.number);
        } catch (error) {
          log(`Failed to ingest issue ${issue.number}: ${messageOf(error)}`);
        }
      }
      return ingested;
    },
  };
}
