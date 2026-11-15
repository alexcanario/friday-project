import {
  runQaStep,
  runSpecialistStep,
  type AgentRunOptions,
  type AgentRuntime,
  type IssueSummary,
  type PipelineStepResult,
  type RunRepository,
  type RunSession,
  type RunSessionFactory,
  type SpecialistResult,
  type WorktreeManager,
} from "@friday/application";
import type { AgentConfig, Criteria, WorkReport } from "@friday/contracts";
import { buildQaStepInput, buildSpecialistRequest } from "@friday/daemon";
import { DEFAULT_PHASES, type WorkflowInput } from "@friday/domain";
import { branchName } from "@friday/infrastructure";
import { createMeteredRuntime, type MeteredRuntime } from "./eval-metered-runtime.ts";

/** Runs the Judge of one experiment run (implemented by #551); the runtime is already metered. */
export type JudgeStepRunner = (input: {
  issue: IssueSummary;
  pr: number;
  cwd: string;
  branch: string;
  base: string;
  expectedHeadSha: string;
  criteria: Criteria["criteria"];
  runtime: AgentRuntime;
  maxBudgetUsd: number;
}) => Promise<{ inputs: WorkflowInput[]; feedback: string | null }>;

export type SessionDeps = {
  worktrees: Pick<WorktreeManager, "create" | "remove" | "isClean">;
  worktreesRoot: string;
  project: string;
  projectId: string;
  base: string;
  configRoot: string;
  runTag: string;
  runtime: AgentRuntime;
  runs: Pick<RunRepository, "save">;
  agents: { roles: Record<string, AgentRunOptions>; qa: AgentRunOptions };
  screenPaths: string[];
  readPrHead: (pr: number) => Promise<string>;
  judge: JudgeStepRunner;
  newRunId: () => string;
  now: () => number;
};

type State = {
  issue: IssueSummary;
  cwd: string;
  branch: string;
  report: WorkReport | null;
  pr: number | null;
  criteria: Criteria["criteria"] | null;
  closed: boolean;
};

type McpTool = AgentConfig["mcp_tools"][number];

const MCP_PREFIX = "mcp__friday__";
const QA_MCP_TOOLS: McpTool[] = ["qa_report", "issue_comment"];

const mcpToolsOf = (card: AgentRunOptions): McpTool[] =>
  card.allowedTools.map(
    (t) => (t.startsWith(MCP_PREFIX) ? t.slice(MCP_PREFIX.length) : t) as McpTool,
  );

function meterOf(deps: SessionDeps, state: State, budgetUsd: number): MeteredRuntime {
  return createMeteredRuntime({
    runtime: deps.runtime,
    runs: deps.runs,
    projectId: deps.projectId,
    issue: state.issue.number,
    budgetUsd,
    newRunId: deps.newRunId,
    now: deps.now,
  });
}

function specialistRequest(deps: SessionDeps, state: State, card: AgentRunOptions, prompt: string) {
  const built = buildSpecialistRequest({
    issue: state.issue,
    criteria: null,
    feedback: null,
    agent: card,
    friday: {
      runId: "unassigned",
      agent: { states: card.states, mcp_tools: mcpToolsOf(card) },
      getIssueState: () => "InProgress",
    },
    cwd: state.cwd,
    configRoot: deps.configRoot,
    branch: state.branch,
    base: deps.base,
    getPullRequest: () => state.pr,
  });
  const friday = built.friday!;
  const run = friday.effects!.run;
  // `buildEffectsRun` drops hooks, so the PR hook is set only after the request is built.
  const onPrCreated = (pr: number) => {
    state.pr = pr;
  };
  return { ...built, prompt, friday: { ...friday, effects: { run: { ...run, onPrCreated } } } };
}

async function runSpecialist(
  deps: SessionDeps,
  state: State,
  input: { role: string; prompt: string; maxBudgetUsd: number },
): Promise<SpecialistResult> {
  const card = deps.agents.roles[input.role];
  if (card === undefined) throw new Error(`Erro: ficha do papel ausente: ${input.role}`);
  const meter = meterOf(deps, state, input.maxBudgetUsd);
  const outcome = await runSpecialistStep(
    { runtime: meter.runtime },
    {
      request: specialistRequest(deps, state, card, input.prompt),
      snapshot: { phases: [...DEFAULT_PHASES], phaseIndex: 0 },
    },
  );
  state.report = "report" in outcome ? outcome.report : null;
  return { inputs: outcome.inputs, feedback: null, ...meter.totals(), report: state.report };
}

async function runQa(
  deps: SessionDeps,
  state: State,
  input: { criteria: Criteria["criteria"]; maxBudgetUsd: number },
): Promise<PipelineStepResult> {
  const report = state.report;
  if (report === null) throw new Error("Erro: QA antes do relatório do especialista");
  state.criteria = input.criteria;
  const step = buildQaStepInput({
    issue: state.issue,
    criteria: input.criteria,
    report: { worktreePath: state.cwd, headSha: report.headSha, changedFiles: report.changedFiles },
    screenPaths: deps.screenPaths,
    agent: deps.agents.qa,
    friday: {
      runId: "unassigned",
      agent: { states: ["QA"], mcp_tools: QA_MCP_TOOLS },
      getIssueState: () => "QA",
    },
    configRoot: deps.configRoot,
    branch: state.branch,
    base: deps.base,
    getPullRequest: () => state.pr,
  });
  const meter = meterOf(deps, state, input.maxBudgetUsd);
  const outcome = await runQaStep({ runtime: meter.runtime, worktrees: deps.worktrees }, step);
  const feedback = "feedback" in outcome ? outcome.feedback : null;
  return { inputs: [outcome.input], feedback, ...meter.totals() };
}

async function runJudge(
  deps: SessionDeps,
  state: State,
  input: { maxBudgetUsd: number },
): Promise<PipelineStepResult> {
  const { pr, criteria } = state;
  if (pr === null) throw new Error("Erro: Judge antes do PR do especialista");
  if (criteria === null) throw new Error("Erro: Judge antes do QA");
  const expectedHeadSha = await deps.readPrHead(pr);
  const meter = meterOf(deps, state, input.maxBudgetUsd);
  const result = await deps.judge({
    issue: state.issue,
    pr,
    cwd: state.cwd,
    branch: state.branch,
    base: deps.base,
    expectedHeadSha,
    criteria,
    runtime: meter.runtime,
    maxBudgetUsd: input.maxBudgetUsd,
  });
  return { inputs: result.inputs, feedback: result.feedback, ...meter.totals() };
}

async function closeSession(deps: SessionDeps, state: State): Promise<void> {
  if (state.closed) return;
  state.closed = true;
  const target = { root: deps.worktreesRoot, project: deps.project, issue: state.issue.number };
  try {
    await deps.worktrees.remove(target);
  } catch {
    // A failed removal never fails the run; the orphan sweep removes it later.
  }
}

async function openSession(
  deps: SessionDeps,
  input: Parameters<RunSessionFactory["open"]>[0],
): Promise<RunSession> {
  const { issue } = input;
  // The issue number repeats across the runs, so the title makes one branch per run and attempt (D113).
  const title = `${input.itemId}-${input.variant}-r${input.repetition}-${deps.runTag}`;
  const created = await deps.worktrees.create({
    root: deps.worktreesRoot,
    project: deps.project,
    issue: issue.number,
    title,
    base: deps.base,
  });
  if (!created.ok) throw new Error(`Erro: ${created.error.message}`);
  const state: State = {
    issue,
    cwd: created.value.path,
    branch: branchName(issue.number, title),
    report: null,
    pr: null,
    criteria: null,
    closed: false,
  };
  return {
    specialist: (i) => runSpecialist(deps, state, i),
    qa: (i) => runQa(deps, state, i),
    judge: (i) => runJudge(deps, state, i),
    close: () => closeSession(deps, state),
  };
}

/** The sessions of the sandbox runner (#545): one worktree and branch per run, each step metered. */
export function createRunSessionFactory(deps: SessionDeps): RunSessionFactory {
  return { open: (input) => openSession(deps, input) };
}
