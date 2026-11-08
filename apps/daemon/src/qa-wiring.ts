import { isAbsolute, join } from "node:path";
import {
  QA_ALLOWED_MCP,
  QA_ALLOWED_TOOLS,
  type AgentRunOptions,
  type AgentRuntime,
  type WorktreeManager,
} from "@friday/application";
import type { BudgetDeps } from "./budget-gate.ts";
import { runQaForIssue } from "./qa-dispatch.ts";
import type { QaApplyResult } from "./qa-apply.ts";
import { qaTargetOf, type QaContext } from "./qa-request.ts";
import type { RunRecorderDeps } from "./run-recorder.ts";
import type { RunRecordingDeps } from "./run-registration.ts";
import { readTickConfig } from "./tick-config.ts";
import { isInsideRoot } from "./verify-wiring.ts";

const MCP_PREFIX = "mcp__friday__";
export const BASH_DENIED = /[;&|<>`*\n\r]|\$\(/;

/** The QA ficha and the per-issue context; the ficha is validated at startup (D75). */
export type QaCompose = {
  agent: AgentRunOptions;
  context: (issueId: number, runId: string) => Omit<QaContext, "agent" | "configRoot"> | null;
};

export type QaBranchDeps = {
  projectId: string;
  root: string;
  compose: QaCompose;
  runtime?: AgentRuntime;
  worktrees: Pick<WorktreeManager, "isClean">;
  recorder: RunRecorderDeps;
  recording: RunRecordingDeps;
  budget: BudgetDeps;
  now: () => Date;
  log?: (message: string) => void;
};

const subsetOf = (values: readonly string[], allowed: readonly string[]): boolean =>
  values.every((v) => allowed.includes(v));

/** Throws when the ficha cannot describe a QA run; fails closed (D47, D74). */
export function assertQaAgentConfig(agent: AgentRunOptions): void {
  const { promptFile } = agent;
  const valid =
    agent.outputKind === "qaReport" &&
    agent.states.length === 1 &&
    agent.states[0] === "QA" &&
    Number.isFinite(agent.maxBudgetUsd) &&
    agent.maxBudgetUsd > 0 &&
    agent.bashAllow.every((entry) => !BASH_DENIED.test(entry)) &&
    promptFile !== "" &&
    !isAbsolute(promptFile) &&
    !promptFile.startsWith("/") &&
    !promptFile.split(/[\\/]/).includes("..") &&
    subsetOf(agent.tools, QA_ALLOWED_TOOLS) &&
    subsetOf(agent.allowedTools, QA_ALLOWED_MCP);
  if (!valid) throw new Error("A ficha do QA é inválida.");
}

/** Pins the ficha, the config root and the run id; nothing of the policy comes from the context (R4). */
function pinnedContext(deps: QaBranchDeps) {
  const { agent } = deps.compose;
  // Safe cast: `assertQaAgentConfig` limits `allowedTools` to QA_ALLOWED_MCP at startup.
  const mcpTools = agent.allowedTools.map((t) =>
    t.startsWith(MCP_PREFIX) ? t.slice(MCP_PREFIX.length) : t,
  ) as QaContext["friday"]["agent"]["mcp_tools"];
  return (issueId: number, runId: string): QaContext | null => {
    const context = deps.compose.context(issueId, runId);
    if (context === null) return null;
    return {
      ...context,
      agent,
      configRoot: deps.root,
      friday: {
        ...context.friday,
        runId,
        agent: { states: agent.states, mcp_tools: mcpTools },
      },
    };
  };
}

/** Builds the QA branch of the dispatcher; config is re-read on every execution. */
export function createQaBranch(deps: QaBranchDeps): (issueId: number) => Promise<QaApplyResult> {
  const worktreesRoot = join(deps.root, "worktrees");
  const inner = qaTargetOf({
    projectId: deps.projectId,
    events: deps.recorder.events,
    context: pinnedContext(deps),
    ...(deps.log === undefined ? {} : { log: deps.log }),
  });
  const targetOf: typeof inner = (issueId, runId) => {
    const input = inner(issueId, runId);
    if (input === null) return null;
    if (!isInsideRoot(worktreesRoot, input.request.cwd)) {
      deps.log?.(`O worktreePath ${input.request.cwd} está fora da raiz do daemon`);
      return null;
    }
    return input;
  };
  return (issueId) => {
    const config = readTickConfig(deps.root);
    if (config === null) {
      deps.log?.(`Falha no QA da issue ${issueId}: o factory.yaml está inválido ou ausente.`);
      return Promise.resolve({ applied: false, feedback: null });
    }
    return runQaForIssue(
      {
        projectId: deps.projectId,
        targetOf,
        step: {
          ...(deps.runtime === undefined ? {} : { runtime: deps.runtime }),
          worktrees: deps.worktrees,
        },
        recorder: deps.recorder,
        recording: deps.recording,
        budget: deps.budget,
        caps: { perDayUsd: config.perDayUsd, perIssueUsd: config.perIssueUsd },
        now: deps.now,
        ...(deps.log === undefined ? {} : { log: deps.log }),
      },
      issueId,
    );
  };
}
