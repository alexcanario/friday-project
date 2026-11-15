import {
  buildEffectsRun,
  runJudgeStep,
  type AgentRunOptions,
  type GitHubPort,
  type IssueSummary,
  type JudgeStepOutcome,
  type ReviewCredential,
  type StaleVerdicts,
} from "@friday/application";
import type { Criteria } from "@friday/contracts";
import type { RunHeldReason } from "@friday/domain";
import type { JudgeStepRunner } from "./eval-session.ts";

export type JudgeRunnerDeps = {
  projectId: string;
  configRoot: string;
  stale: StaleVerdicts;
  readPrHead: (pr: number) => Promise<string>;
  reviewer: (token: string) => Pick<GitHubPort, "postReview">;
  env: Record<string, string | undefined>;
  review: ReviewCredential;
  agents: Record<"judge" | "judge-strong", AgentRunOptions>;
};

type JudgeResult = Awaited<ReturnType<JudgeStepRunner>>;

/**
 * The Judge prompt of an experiment run: the daemon's `judgeInputOf` prompt plus the criteria,
 * without the QA report (D115 item 2), so the three variants get the same prompt.
 */
export function judgePromptOf(input: {
  issue: IssueSummary;
  headSha: string;
  criteria: Criteria["criteria"];
}): string {
  const head = `Review the pull request of issue #${input.issue.number}. The head SHA of the pull request is ${input.headSha}. Read the diff with pr_diff and finish by calling review_verdict once, with that value in headSha.`;
  const lines = input.criteria.map((c) => {
    const proof = c.proof.kind === "command" ? c.proof.command : c.proof.step;
    return `${c.index}. ${c.claim} [${c.proof.kind}: ${proof}]`;
  });
  return [head, "", "Critérios de aceite:", ...lines].join("\n");
}

const held = (reason: RunHeldReason): JudgeResult => ({
  inputs: [{ type: "RunHeld", reason }],
  feedback: null,
});

/** Maps every Judge outcome to the workflow inputs of the pipeline loop (#538). */
function resultOf(outcome: JudgeStepOutcome): JudgeResult {
  switch (outcome.kind) {
    case "changes_requested":
      return { inputs: [outcome.input], feedback: outcome.feedback };
    // head_mismatch is a ReviewApproved for another head: the domain refuses it (HeadShaMismatch).
    case "approved":
    case "rejected":
    case "held":
    case "head_mismatch":
      return { inputs: [outcome.input], feedback: null };
    case "invalid":
      return held("SchemaInvalid");
    case "stale":
      return held("RuntimeFailed");
  }
}

/**
 * The Judge of one experiment run over `runJudgeStep`. The runtime comes already metered by the
 * session (#546), which caps each call; errors of the step (a missing token) are not caught.
 */
export function createJudgeStepRunner(deps: JudgeRunnerDeps): JudgeStepRunner {
  const { projectId, configRoot, ...step } = deps;
  return async (input) => {
    const { issue } = input;
    const run = buildEffectsRun({
      issue: issue.number,
      role: "judge",
      branch: input.branch,
      base: input.base,
      worktree: input.cwd,
      getPullRequest: () => input.pr,
    });
    const outcome = await runJudgeStep(
      { ...step, runtime: input.runtime },
      {
        projectId,
        issue: { id: issue.number, body: issue.body, labels: issue.labels },
        pr: input.pr,
        expectedHeadSha: input.expectedHeadSha,
        cwd: input.cwd,
        prompt: judgePromptOf({ issue, headSha: input.expectedHeadSha, criteria: input.criteria }),
        configRoot,
        // The metered runtime of the session replaces the run id on every call.
        friday: { runId: "unassigned", getIssueState: () => "InReview", effects: { run } },
      },
    );
    return resultOf(outcome);
  };
}
