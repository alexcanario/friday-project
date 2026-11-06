import type { AgentConfig } from "@friday/contracts";
import type { IssueState } from "@friday/domain";

export const EFFECT_TOOLS = ["git_push", "pr_create", "pr_diff", "issue_comment"] as const;
export type EffectTool = (typeof EFFECT_TOOLS)[number];

export type EffectRequest = {
  tool: EffectTool;
  agent: Pick<AgentConfig, "states" | "mcp_tools">;
  issueState: IssueState;
  runActive: boolean;
};

export type EffectOutcome =
  { status: 200 } | { status: 403; message: string } | { status: 404; message: string };

/** Gates in fixed order: 403, then 404, then 200. `issue_comment` is never allowed in review (D56). */
export function checkEffect(request: EffectRequest): EffectOutcome {
  const { tool, agent, issueState, runActive } = request;
  if (
    !(agent.mcp_tools as string[]).includes(tool) ||
    !(agent.states as readonly string[]).includes(issueState) ||
    (tool === "issue_comment" && issueState === "InReview")
  ) {
    return { status: 403, message: "Ferramenta não permitida para este papel ou estado da issue." };
  }
  if (!runActive) return { status: 404, message: "A run não está ativa." };
  return { status: 200 };
}
