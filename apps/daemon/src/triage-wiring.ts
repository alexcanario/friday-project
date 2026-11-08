import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentRuntime, GitHubPort, IssueSummary } from "@friday/application";
import { loadFactoryConfig } from "@friday/infrastructure";
import type { BudgetDeps } from "./budget-gate.ts";
import type { RunRecorderDeps } from "./run-recorder.ts";
import type { RunRecordingDeps } from "./run-registration.ts";
import { readTickConfig } from "./tick-config.ts";
import { runTriageForIssue, type TriageFlow, type TriageResult } from "./triage-dispatch.ts";
import { buildTriageRequest, type TriageFicha } from "./triage-request.ts";

export type TriageBranchDeps = {
  projectId: string;
  root: string;
  ficha: TriageFicha;
  github: Pick<GitHubPort, "addLabel" | "postAgentComment">;
  runtime: AgentRuntime;
  recorder: RunRecorderDeps;
  recording: RunRecordingDeps;
  budget: BudgetDeps;
  now: () => Date;
  log?: (message: string) => void;
};

/** Builds the triage branch of the dispatcher; config and prompt come from the central root, never a worktree (R4). */
export function createTriageBranch(
  deps: TriageBranchDeps,
): (issue: IssueSummary) => Promise<TriageResult> {
  const cwd = join(deps.root, ".friday", "triage");
  mkdirSync(cwd, { recursive: true });
  const readFlow = (): TriageFlow | null => {
    const loaded = loadFactoryConfig(deps.root);
    if (!loaded.ok) return null;
    const { model, max_budget_usd: maxBudgetUsd } = loaded.config.flow.triage;
    return { model, maxBudgetUsd };
  };
  const readCaps = () => {
    const tick = readTickConfig(deps.root);
    return tick === null ? null : { perDayUsd: tick.perDayUsd, perIssueUsd: tick.perIssueUsd };
  };
  return (issue) =>
    runTriageForIssue(
      {
        projectId: deps.projectId,
        github: deps.github,
        runtime: deps.runtime,
        readFlow,
        readCaps,
        request: (i, flow) =>
          buildTriageRequest({ issue: i, flow, ficha: deps.ficha, cwd, configRoot: deps.root }),
        recorder: deps.recorder,
        recording: deps.recording,
        budget: deps.budget,
        now: deps.now,
        ...(deps.log === undefined ? {} : { log: deps.log }),
      },
      issue,
    );
}
