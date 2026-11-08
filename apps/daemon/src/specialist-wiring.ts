import { isAbsolute } from "node:path";
import type {
  AgentRunOptions,
  AgentRuntime,
  GitHubPort,
  WorktreeManager,
} from "@friday/application";
import { SPECIALIST_ALLOWED_MCP } from "@friday/application";
import { branchName, loadFactoryConfig } from "@friday/infrastructure";
import type { BudgetDeps } from "./budget-gate.ts";
import { createPrOf } from "./pr-of.ts";
import { BASH_DENIED } from "./qa-wiring.ts";
import type { RunRecorderDeps } from "./run-recorder.ts";
import type { RunRecordingDeps } from "./run-registration.ts";
import { runSpecialistForIssue } from "./specialist-dispatch.ts";
import { buildSpecialistRequest, criteriaOf, feedbackOf } from "./specialist-request.ts";
import { readTickConfig } from "./tick-config.ts";
import { isInsideRoot } from "./verify-wiring.ts";

const MCP_PREFIX = "mcp__friday__";

export const SPECIALIST_ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Bash", "Edit", "Write"] as const;

/** The specialist ficha, validated at startup (D70, D75). */
export type SpecialistCompose = { agent: AgentRunOptions };

export type SpecialistBranchDeps = {
  projectId: string;
  root: string;
  worktreesRoot: string;
  compose: SpecialistCompose;
  github: Pick<GitHubPort, "listIssuesByLabel">;
  worktrees: Pick<WorktreeManager, "create" | "list">;
  runtime: AgentRuntime;
  recorder: RunRecorderDeps;
  recording: RunRecordingDeps;
  budget: BudgetDeps;
  now: () => Date;
  log?: (message: string) => void;
};

type Result = { applied: boolean; feedback: null };
const NOT_APPLIED: Result = { applied: false, feedback: null };

const subsetOf = (values: readonly string[], allowed: readonly string[]): boolean =>
  values.every((v) => allowed.includes(v));

/** Throws when the ficha cannot describe a specialist run; fails closed (D47, D74). */
export function assertSpecialistAgentConfig(agent: AgentRunOptions): void {
  const { promptFile } = agent;
  const valid =
    agent.outputKind === "workReport" &&
    agent.states.length === 1 &&
    agent.states[0] === "InProgress" &&
    Number.isFinite(agent.maxBudgetUsd) &&
    agent.maxBudgetUsd > 0 &&
    agent.bashAllow.every((entry) => !BASH_DENIED.test(entry)) &&
    promptFile !== "" &&
    !isAbsolute(promptFile) &&
    !promptFile.startsWith("/") &&
    !promptFile.split(/[\\/]/).includes("..") &&
    subsetOf(agent.tools, SPECIALIST_ALLOWED_TOOLS) &&
    subsetOf(agent.allowedTools, SPECIALIST_ALLOWED_MCP);
  if (!valid) throw new Error("A ficha do especialista é inválida.");
}

type Repository = { owner: string; name: string; base: string };

/** Creates the issue's worktree, or reuses the existing one (feedback round); null when none is usable. */
async function worktreeOf(
  deps: SpecialistBranchDeps,
  issueId: number,
  title: string,
  repository: Repository,
): Promise<string | null> {
  const project = `${repository.owner}__${repository.name}`;
  const created = await deps.worktrees.create({
    root: deps.worktreesRoot,
    project,
    issue: issueId,
    title,
    base: repository.base,
  });
  if (created.ok) return created.value.path;
  if (created.error.code !== "WorktreeExists") {
    deps.log?.(`Falha no especialista da issue ${issueId}: ${created.error.message}`);
    return null;
  }
  const listed = await deps.worktrees.list({ root: deps.worktreesRoot, project });
  const found = listed.ok ? listed.value.find((w) => w.issue === issueId) : undefined;
  if (found === undefined) {
    deps.log?.(
      `Falha no especialista da issue ${issueId}: a worktree existente não foi encontrada.`,
    );
    return null;
  }
  return found.path;
}

type McpTools = Parameters<typeof buildSpecialistRequest>[0]["friday"]["agent"]["mcp_tools"];

type TargetInput = {
  issue: { number: number; title: string; body: string };
  path: string;
  base: string;
  mcpTools: McpTools;
};

/** Builds the specialist request for one run of the issue. */
function targetOf(deps: SpecialistBranchDeps, t: TargetInput, id: number, runId: string) {
  const { agent } = deps.compose;
  return buildSpecialistRequest({
    issue: { number: t.issue.number, title: t.issue.title, body: t.issue.body },
    criteria: criteriaOf(deps.recorder.events.list(deps.projectId, id)),
    feedback: feedbackOf(deps.recorder.events.list(deps.projectId, id)),
    agent,
    configRoot: deps.root,
    cwd: t.path,
    branch: branchName(t.issue.number, t.issue.title),
    base: t.base,
    getPullRequest: () => createPrOf(deps.recorder.events, deps.projectId)(id),
    friday: {
      runId,
      agent: { states: agent.states, mcp_tools: t.mcpTools },
      getIssueState: () => {
        const state = deps.recorder.issues.get(deps.projectId, id)?.state;
        return state as ReturnType<
          Parameters<typeof buildSpecialistRequest>[0]["friday"]["getIssueState"]
        >;
      },
    },
  });
}

/** Builds the specialist branch of the dispatcher; config is re-read on every execution. */
export function createSpecialistBranch(
  deps: SpecialistBranchDeps,
): (issueId: number) => Promise<Result> {
  const { agent } = deps.compose;
  // Safe cast: `assertSpecialistAgentConfig` limits `allowedTools` to SPECIALIST_ALLOWED_MCP at startup.
  const mcpTools = agent.allowedTools.map((t) =>
    t.startsWith(MCP_PREFIX) ? t.slice(MCP_PREFIX.length) : t,
  ) as Parameters<typeof buildSpecialistRequest>[0]["friday"]["agent"]["mcp_tools"];

  return async (issueId) => {
    const fail = (reason: string): Result => {
      deps.log?.(`Falha no especialista da issue ${issueId}: ${reason}`);
      return NOT_APPLIED;
    };
    const config = readTickConfig(deps.root);
    const loaded = loadFactoryConfig(deps.root);
    if (config === null || !loaded.ok) return fail("o factory.yaml está inválido ou ausente.");
    const issues = await deps.github.listIssuesByLabel("friday");
    const issue = issues.find((i) => i.number === issueId);
    if (issue === undefined) return fail("a issue não está entre as marcadas com o label friday.");
    const { owner, name, base } = loaded.config.repository;
    const path = await worktreeOf(deps, issueId, issue.title, { owner, name, base });
    if (path === null) return NOT_APPLIED;
    if (!isInsideRoot(deps.worktreesRoot, path)) {
      return fail(`a worktree ${path} está fora da raiz do daemon.`);
    }
    const target = { issue, path, base, mcpTools };
    return runSpecialistForIssue(
      {
        projectId: deps.projectId,
        targetOf: (id, runId) => targetOf(deps, target, id, runId),
        step: { runtime: deps.runtime },
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
