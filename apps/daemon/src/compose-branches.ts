import { join } from "node:path";
import type { AgentRuntime, GitHubPort, WorktreeManager } from "@friday/application";
import type { BudgetDeps } from "./budget-gate.ts";
import { createJudgeBranch, type JudgeCompose } from "./judge-wiring.ts";
import { createQaBranch, type QaCompose } from "./qa-wiring.ts";
import type { RunRecorderDeps } from "./run-recorder.ts";
import type { RunRecordingDeps } from "./run-registration.ts";
import { createSpecialistBranch, type SpecialistCompose } from "./specialist-wiring.ts";
import type { TriageAgentConfig } from "./triage-request.ts";
import { createTriageBranch } from "./triage-wiring.ts";

export type Repo = { owner: string; repo: string };

/** The options of `composeDaemon` that the optional dispatcher branches read. */
export type BranchOptions = {
  projectId: string;
  root: string;
  env: Record<string, string | undefined>;
  runtime: AgentRuntime;
  worktrees: WorktreeManager;
  log?: (message: string) => void;
  judge?: JudgeCompose;
  qa?: QaCompose;
  specialist?: SpecialistCompose;
  worktreesRoot?: string;
  triage?: TriageAgentConfig;
};

/** What the composition already built and the branches share. */
export type BranchContext = {
  github: GitHubPort;
  repo: Repo;
  /** Builds the GitHub client of another token (the Judge's review token, D53). */
  clientFor: (token: string, repo: Repo) => GitHubPort;
  recorderDeps: RunRecorderDeps;
  recording: RunRecordingDeps;
  budget: BudgetDeps;
  now: () => Date;
  prOf: (issueId: number) => number | null;
};

const logOf = (opts: BranchOptions) => (opts.log === undefined ? {} : { log: opts.log });

/** The Judge branch, or nothing when `opts.judge` is absent (D64, D73). */
export function judgeBranchOf(opts: BranchOptions, ctx: BranchContext) {
  if (opts.judge === undefined) return {};
  const { github, repo, clientFor, recorderDeps, recording, budget, now } = ctx;
  return {
    judge: createJudgeBranch({
      projectId: opts.projectId,
      root: opts.root,
      github,
      reviewerFor: (token) => clientFor(token, repo),
      compose: opts.judge,
      env: opts.env,
      runtime: opts.runtime,
      prOf: ctx.prOf,
      recorder: recorderDeps,
      recording,
      budget,
      now,
      ...logOf(opts),
    }),
  };
}

/** The triage branch, or nothing when `opts.triage` is absent. */
export function triageBranchOf(opts: BranchOptions, ctx: BranchContext) {
  if (opts.triage === undefined) return {};
  const { github, recorderDeps, recording, budget, now } = ctx;
  return {
    triage: createTriageBranch({
      projectId: opts.projectId,
      root: opts.root,
      agentConfig: opts.triage,
      github,
      runtime: opts.runtime,
      recorder: recorderDeps,
      recording,
      budget,
      now,
      ...logOf(opts),
    }),
  };
}

/** The QA branch, or nothing when `opts.qa` is absent (D70, D75). */
export function qaBranchOf(opts: BranchOptions, ctx: BranchContext) {
  if (opts.qa === undefined) return {};
  const { recorderDeps, recording, budget, now } = ctx;
  return {
    qa: createQaBranch({
      projectId: opts.projectId,
      root: opts.root,
      compose: opts.qa,
      runtime: opts.runtime,
      worktrees: opts.worktrees,
      recorder: recorderDeps,
      recording,
      budget,
      now,
      ...logOf(opts),
    }),
  };
}

/** The specialist branch, or nothing when `opts.specialist` is absent (D70, D75). */
export function specialistBranchOf(opts: BranchOptions, ctx: BranchContext) {
  if (opts.specialist === undefined) return {};
  const { github, recorderDeps, recording, budget, now } = ctx;
  return {
    specialist: createSpecialistBranch({
      projectId: opts.projectId,
      root: opts.root,
      worktreesRoot: opts.worktreesRoot ?? join(opts.root, "worktrees"),
      compose: opts.specialist,
      github,
      worktrees: opts.worktrees,
      runtime: opts.runtime,
      recorder: recorderDeps,
      recording,
      budget,
      now,
      ...logOf(opts),
    }),
  };
}
