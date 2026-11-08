import {
  classifyRisk as realClassifyRisk,
  decideGates as realDecideGates,
  type EventStore,
  type GitHubPort,
  type IssueRepository,
} from "@friday/application";
import type { AgentRunRequest, IssueSummary } from "@friday/application";
import type { IssueState } from "@friday/domain";
import type { ApprovalDeps } from "./approval-wiring.ts";
import { snapshotOf } from "./run-recorder.ts";
import { createHandlerEnv, logError, ownHandler, type Capacity } from "./state-handlers.ts";
import type { RunRequestBuilder } from "./tick.ts";

export type DispatchRole = "triage" | "specialist" | "verify" | "qa" | "judge";

export const STATE_ROLES: Partial<Record<IssueState, DispatchRole>> = {
  Todo: "triage",
  Triage: "triage",
  InProgress: "specialist",
  Verify: "verify",
  QA: "qa",
  InReview: "judge",
};

export type DispatchConfig = {
  risk: Parameters<typeof realClassifyRisk>[1];
  mergeMode: "manual" | "auto";
  screenPaths: string[];
};

export type StateDispatcherDeps = {
  projectId: string;
  github: Pick<GitHubPort, "listIssuesByLabel" | "getPrDiff" | "addLabel">;
  issues: IssueRepository;
  events: EventStore;
  roles: Partial<Record<DispatchRole, RunRequestBuilder>>;
  readConfig: () => DispatchConfig | null;
  prOf: (issueId: number) => number | null;
  now: () => Date;
  log?: (message: string) => void;
  classifyRisk?: typeof realClassifyRisk;
  decideGates?: typeof realDecideGates;
  /** Human approval flow; without it AwaitingApproval is left alone. */
  approval?: ApprovalDeps;
  /** Runs the Judge for an issue in review; replaces the role-based dispatch of InReview. */
  judge?: (issueId: number) => Promise<{ applied: boolean; feedback: string | null }>;
  /** Runs QA for an issue in QA; replaces the role-based dispatch of QA. */
  qa?: (issueId: number) => Promise<{ applied: boolean; feedback: string | null }>;
  /** Runs the specialist for an issue in progress; replaces the role-based dispatch of InProgress. */
  specialist?: (issueId: number) => Promise<{ applied: boolean; feedback: string | null }>;
  /** Runs Verify for an issue in Verify; replaces the role-based dispatch of Verify. */
  verify?: (issueId: number) => Promise<{ applied: boolean; feedback: string | null }>;
  /** Runs triage for an issue in Todo or Triage; replaces the role-based dispatch of both. */
  triage?: (issue: IssueSummary) => Promise<{ applied: boolean; feedback: null }>;
};

export type StateDispatcher = {
  /** `capacity` is optional only for direct calls (tests, uses without a ticker). */
  listReady(capacity?: Capacity): Promise<number[]>;
  /** Judge, QA and specialist runs in flight; they occupy a slot of maxConcurrentRuns (D68). */
  busy(): number;
  buildRequest(issueId: number, runId?: string): AgentRunRequest;
};

const DISPATCH_LABEL = "friday";

export function createStateDispatcher(deps: StateDispatcherDeps): StateDispatcher {
  let dispatched = new Map<number, DispatchRole>();
  const env = createHandlerEnv(deps);

  async function inspect(
    issue: IssueSummary,
    next: Map<number, DispatchRole>,
    capacity: Capacity | undefined,
  ): Promise<void> {
    const row = deps.issues.get(deps.projectId, issue.number);
    if (row === null) return;
    const snapshot = snapshotOf(row);
    if (snapshot === null) {
      deps.log?.(`Linha inválida para a issue ${issue.number}: estado ou motivo desconhecido`);
      return;
    }
    const owned = ownHandler(env, snapshot.state, issue, capacity);
    if (owned !== null) return owned;
    const role = STATE_ROLES[snapshot.state];
    if (role !== undefined && deps.roles[role] !== undefined) next.set(issue.number, role);
  }

  async function listReady(capacity?: Capacity): Promise<number[]> {
    const next = new Map<number, DispatchRole>();
    try {
      for (const issue of await deps.github.listIssuesByLabel(DISPATCH_LABEL)) {
        if (next.has(issue.number)) continue;
        try {
          await inspect(issue, next, capacity);
        } catch (error) {
          logError(env, `Falha ao despachar a issue ${issue.number}`, error);
        }
      }
    } catch (error) {
      logError(env, "Falha ao listar as issues", error);
    }
    dispatched = next;
    return [...next.keys()];
  }

  return {
    listReady,
    busy: env.inFlight,
    buildRequest(issueId, runId) {
      const role = dispatched.get(issueId);
      const builder = role === undefined ? undefined : deps.roles[role];
      if (builder === undefined)
        throw new Error(`A issue ${issueId} não foi despachada por estado`);
      return builder(issueId, runId);
    },
  };
}
