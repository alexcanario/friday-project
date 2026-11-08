import {
  classifyRisk as realClassifyRisk,
  decideGates as realDecideGates,
  type IssueSummary,
} from "@friday/application";
import type { IssueState, Risk } from "@friday/domain";
import {
  handleAwaitingApproval,
  headForApproval,
  recordApprovalRequest,
  type ApprovalContext,
  type ApprovalDeps,
} from "./approval-wiring.ts";
import { runGuardedTriage } from "./dispatch-guard.ts";
import { applyInput } from "./run-recorder.ts";
import type { StateDispatcherDeps } from "./state-dispatcher.ts";
import { runGuardedVerify } from "./verify-dispatch.ts";

export type Capacity = { active: number; max: number };

/** What the per-state handlers share: the deps plus the in-flight sets of the dispatcher. */
export type HandlerEnv = {
  deps: StateDispatcherDeps;
  classify: typeof realClassifyRisk;
  decide: typeof realDecideGates;
  judging: Set<number>;
  qaRunning: Set<number>;
  specialistRunning: Set<number>;
  verifyRunning: Set<number>;
  triageRunning: Set<number>;
  inFlight(): number;
};

export function createHandlerEnv(deps: StateDispatcherDeps): HandlerEnv {
  const env: HandlerEnv = {
    deps,
    classify: deps.classifyRisk ?? realClassifyRisk,
    decide: deps.decideGates ?? realDecideGates,
    judging: new Set<number>(),
    qaRunning: new Set<number>(),
    specialistRunning: new Set<number>(),
    verifyRunning: new Set<number>(),
    triageRunning: new Set<number>(),
    inFlight: () =>
      env.judging.size +
      env.qaRunning.size +
      env.specialistRunning.size +
      env.verifyRunning.size +
      env.triageRunning.size,
  };
  return env;
}

export function logError(env: HandlerEnv, message: string, error: unknown): void {
  env.deps.log?.(`${message}: ${error instanceof Error ? error.message : String(error)}`);
}

async function tierOf(env: HandlerEnv, pr: number): Promise<Risk | null> {
  const diff = await env.deps.github.getPrDiff(pr);
  const config = env.deps.readConfig();
  return config === null ? null : env.classify(diff, config.risk).risk;
}

export function approvalContext(env: HandlerEnv, approval: ApprovalDeps): ApprovalContext {
  const { deps } = env;
  return {
    projectId: deps.projectId,
    events: deps.events,
    issues: deps.issues,
    now: deps.now,
    ...(deps.log === undefined ? {} : { log: deps.log }),
    approval,
    prOf: deps.prOf,
    tierOf: (pr) => tierOf(env, pr),
  };
}

async function applyGates(env: HandlerEnv, issueId: number, gates: string[]): Promise<void> {
  for (const gate of gates) {
    try {
      await env.deps.github.addLabel(issueId, gate);
    } catch (error) {
      logError(env, `Falha ao aplicar o label ${gate} na issue ${issueId}`, error);
    }
  }
}

function requestApproval(
  env: HandlerEnv,
  approval: ApprovalDeps,
  request: { issueId: number; pr: number; headSha: string; tier: Risk },
): void {
  try {
    recordApprovalRequest(approvalContext(env, approval), request);
  } catch (error) {
    logError(env, `Falha ao gravar o pedido de aprovação da issue ${request.issueId}`, error);
  }
}

type Decision = ReturnType<typeof realDecideGates>;

async function assess(
  env: HandlerEnv,
  issueId: number,
  labels: string[],
): Promise<{ pr: number; decision: Decision } | null> {
  const { deps } = env;
  const pr = deps.prOf(issueId);
  if (pr === null) {
    deps.log?.(`A issue ${issueId} em RiskCheck não tem PR associado`);
    return null;
  }
  const diff = await deps.github.getPrDiff(pr);
  const config = deps.readConfig();
  if (config === null) {
    deps.log?.(`Configuração de risco indisponível para a issue ${issueId}`);
    return null;
  }
  const decision = env.decide({
    risk: env.classify(diff, config.risk).risk,
    mergeMode: config.mergeMode,
    changedPaths: diff.files.map((f) => f.path),
    screenPaths: config.screenPaths,
    issueGates: labels.filter((l) => l.startsWith("gate:")),
  });
  return { pr, decision };
}

export async function handleRiskCheck(
  env: HandlerEnv,
  issueId: number,
  labels: string[],
): Promise<void> {
  const { deps } = env;
  const assessed = await assess(env, issueId, labels);
  if (assessed === null) return;
  const { pr, decision } = assessed;
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
    requestApproval(env, deps.approval, { issueId, pr, headSha, tier: decision.risk });
  }
  await applyGates(env, issueId, decision.gates);
}

/** Runs `run` once per issue under the shared capacity; failures are logged, never thrown. */
async function runGuarded(
  env: HandlerEnv,
  running: Set<number>,
  issueId: number,
  run: (issueId: number) => Promise<unknown>,
  capacity: Capacity | undefined,
  failure: string,
): Promise<void> {
  if (running.has(issueId)) return;
  if (capacity !== undefined && capacity.active + env.inFlight() >= capacity.max) return;
  running.add(issueId);
  try {
    await run(issueId);
  } catch (error) {
    logError(env, `${failure} ${issueId}`, error);
  } finally {
    running.delete(issueId);
  }
}

/** The handler that owns `state` for this issue, or null when the role-based dispatch applies. */
export function ownHandler(
  env: HandlerEnv,
  state: IssueState,
  issue: IssueSummary,
  capacity: Capacity | undefined,
): Promise<void> | null {
  const { deps } = env;
  const n = issue.number;
  const log = (message: string): void => deps.log?.(message);
  switch (state) {
    case "RiskCheck":
      return handleRiskCheck(env, n, issue.labels);
    case "AwaitingApproval":
      return deps.approval === undefined
        ? null
        : handleAwaitingApproval(approvalContext(env, deps.approval), n);
    case "InReview":
      return deps.judge === undefined
        ? null
        : runGuarded(env, env.judging, n, deps.judge, capacity, "Falha ao rodar o Judge da issue");
    case "QA":
      return deps.qa === undefined
        ? null
        : runGuarded(env, env.qaRunning, n, deps.qa, capacity, "Falha ao rodar o QA da issue");
    case "InProgress":
      return deps.specialist === undefined
        ? null
        : runGuarded(
            env,
            env.specialistRunning,
            n,
            deps.specialist,
            capacity,
            "Falha ao rodar o especialista da issue",
          );
    case "Verify":
      return deps.verify === undefined
        ? null
        : runGuardedVerify(deps.verify, env.verifyRunning, env.inFlight(), capacity, n, log);
    case "Todo":
    case "Triage":
      return deps.triage === undefined
        ? null
        : runGuardedTriage(deps.triage, env.triageRunning, env.inFlight(), capacity, issue, log);
    default:
      return null;
  }
}
