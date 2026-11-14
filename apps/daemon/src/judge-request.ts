import {
  buildEffectsRun,
  type EffectTool,
  type IssueRepository,
  type JudgeStepInput,
} from "@friday/application";

export type JudgeFridayInput = {
  projectId: string;
  issueId: number;
  runId: string;
  pr: number;
  base: string;
  cwd: string;
  issues: Pick<IssueRepository, "get">;
  /** Called by the MCP handler when an effect tool fails; `buildEffectsRun` drops it, so it is set after. */
  onEffectError?: (tool: EffectTool, error: unknown) => void;
};

/** The `friday` MCP server of a Judge run: `pr_diff` reads `pr`; branch and worktree only satisfy `buildEffectsRun`. */
export function judgeFridayOf(input: JudgeFridayInput): JudgeStepInput["friday"] {
  const { projectId, issueId, issues } = input;
  const run = buildEffectsRun({
    issue: issueId,
    role: "judge",
    branch: `friday/${issueId}`,
    base: input.base,
    worktree: input.cwd,
    getPullRequest: () => input.pr,
  });
  return {
    runId: input.runId,
    getIssueState: () => {
      const state = issues.get(projectId, issueId)?.state;
      return state as ReturnType<JudgeStepInput["friday"]["getIssueState"]>;
    },
    effects: {
      run: input.onEffectError === undefined ? run : { ...run, onEffectError: input.onEffectError },
    },
  };
}
