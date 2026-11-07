import {
  classifyRisk as realClassifyRisk,
  decideGates as realDecideGates,
  type EventStore,
  type GitHubPort,
  type IssueRepository,
} from "@friday/application";
import type { AgentRunRequest } from "@friday/application";
import type { IssueState } from "@friday/domain";
import {
  handleAwaitingApproval,
  headForApproval,
  recordApprovalRequest,
  type ApprovalDeps,
} from "./approval-wiring.ts";
import { applyInput, snapshotOf } from "./run-recorder.ts";
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
};

type Capacity = { active: number; max: number };

export type StateDispatcher = {
  /** `capacity` is optional only for direct calls (tests, uses without a ticker). */
  listReady(capacity?: Capacity): Promise<number[]>;
  /** Judge and QA runs in flight; they occupy a slot of maxConcurrentRuns (D68). */
  busy(): number;
  buildRequest(issueId: number): AgentRunRequest;
};

const DISPATCH_LABEL = "friday";

export function createStateDispatcher(deps: StateDispatcherDeps): StateDispatcher {
  const classify = deps.classifyRisk ?? realClassifyRisk;
  const decide = deps.decideGates ?? realDecideGates;
  let dispatched = new Map<number, DispatchRole>();
  const judging = new Set<number>();
  const qaRunning = new Set<number>();

  const logError = (message: string, error: unknown): void => {
    deps.log?.(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  };

  const approvalContext = (approval: ApprovalDeps) => ({
    projectId: deps.projectId,
    events: deps.events,
    issues: deps.issues,
    now: deps.now,
    ...(deps.log === undefined ? {} : { log: deps.log }),
    approval,
  });

  async function handleRiskCheck(issueId: number, labels: string[]): Promise<void> {
    const pr = deps.prOf(issueId);
    if (pr === null) {
      deps.log?.(`A issue ${issueId} em RiskCheck não tem PR associado`);
      return;
    }
    const diff = await deps.github.getPrDiff(pr);
    const config = deps.readConfig();
    if (config === null) {
      deps.log?.(`Configuração de risco indisponível para a issue ${issueId}`);
      return;
    }
    const verdict = classify(diff, config.risk);
    const decision = decide({
      risk: verdict.risk,
      mergeMode: config.mergeMode,
      changedPaths: diff.files.map((f) => f.path),
      screenPaths: config.screenPaths,
      issueGates: labels.filter((l) => l.startsWith("gate:")),
    });
    const headPending =
      deps.approval === undefined ? null : headForApproval(deps.approval, pr, decision);
    const headSha = headPending === null ? null : await headPending;
    const accepted = applyInput(
      { projectId: deps.projectId, events: deps.events, issues: deps.issues, now: deps.now },
      { issueId, runId: null },
      { type: "RiskAssessed", risk: decision.risk, autoMerge: decision.autoMerge },
    );
    if (!accepted) {
      deps.log?.(`RiskAssessed recusado para a issue ${issueId}`);
      return;
    }
    if (deps.approval !== undefined && headSha !== null) {
      try {
        recordApprovalRequest(approvalContext(deps.approval), {
          issueId,
          pr,
          headSha,
          tier: decision.risk,
        });
      } catch (error) {
        logError(`Falha ao gravar o pedido de aprovação da issue ${issueId}`, error);
      }
    }
    for (const gate of decision.gates) {
      try {
        await deps.github.addLabel(issueId, gate);
      } catch (error) {
        logError(`Falha ao aplicar o label ${gate} na issue ${issueId}`, error);
      }
    }
  }

  async function handleJudge(
    issueId: number,
    judge: NonNullable<StateDispatcherDeps["judge"]>,
    capacity: Capacity | undefined,
  ): Promise<void> {
    if (judging.has(issueId)) return;
    if (capacity !== undefined && capacity.active + judging.size + qaRunning.size >= capacity.max)
      return;
    judging.add(issueId);
    try {
      await judge(issueId);
    } catch (error) {
      logError(`Falha ao rodar o Judge da issue ${issueId}`, error);
    } finally {
      judging.delete(issueId);
    }
  }

  async function handleQa(
    issueId: number,
    qa: NonNullable<StateDispatcherDeps["qa"]>,
    capacity: Capacity | undefined,
  ): Promise<void> {
    if (qaRunning.has(issueId)) return;
    const used = judging.size + qaRunning.size;
    if (capacity !== undefined && capacity.active + used >= capacity.max) return;
    qaRunning.add(issueId);
    try {
      await qa(issueId);
    } catch (error) {
      logError(`Falha ao rodar o QA da issue ${issueId}`, error);
    } finally {
      qaRunning.delete(issueId);
    }
  }

  async function inspect(
    number: number,
    labels: string[],
    next: Map<number, DispatchRole>,
    capacity: Capacity | undefined,
  ): Promise<void> {
    const row = deps.issues.get(deps.projectId, number);
    if (row === null) return;
    const snapshot = snapshotOf(row);
    if (snapshot === null) {
      deps.log?.(`Linha inválida para a issue ${number}: estado ou motivo desconhecido`);
      return;
    }
    if (snapshot.state === "RiskCheck") {
      await handleRiskCheck(number, labels);
      return;
    }
    if (snapshot.state === "AwaitingApproval" && deps.approval !== undefined) {
      await handleAwaitingApproval(approvalContext(deps.approval), number);
      return;
    }
    if (snapshot.state === "InReview" && deps.judge !== undefined) {
      await handleJudge(number, deps.judge, capacity);
      return;
    }
    if (snapshot.state === "QA" && deps.qa !== undefined) {
      await handleQa(number, deps.qa, capacity);
      return;
    }
    const role = STATE_ROLES[snapshot.state];
    if (role !== undefined && deps.roles[role] !== undefined) next.set(number, role);
  }

  return {
    async listReady(capacity) {
      const next = new Map<number, DispatchRole>();
      try {
        const found = await deps.github.listIssuesByLabel(DISPATCH_LABEL);
        for (const issue of found) {
          if (next.has(issue.number)) continue;
          try {
            await inspect(issue.number, issue.labels, next, capacity);
          } catch (error) {
            logError(`Falha ao despachar a issue ${issue.number}`, error);
          }
        }
      } catch (error) {
        logError("Falha ao listar as issues", error);
      }
      dispatched = next;
      return [...next.keys()];
    },
    busy: () => judging.size + qaRunning.size,
    buildRequest(issueId) {
      const role = dispatched.get(issueId);
      const builder = role === undefined ? undefined : deps.roles[role];
      if (builder === undefined)
        throw new Error(`A issue ${issueId} não foi despachada por estado`);
      return builder(issueId);
    },
  };
}
