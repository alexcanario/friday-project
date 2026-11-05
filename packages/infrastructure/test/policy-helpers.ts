import type { AgentRunOptions } from "@friday/application";

export function agentFor(over: Partial<AgentRunOptions> = {}): AgentRunOptions {
  return {
    model: "sonnet",
    states: ["InProgress"],
    maxBudgetUsd: 1,
    maxTurns: 10,
    timeoutMs: 60000,
    tools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
    allowedTools: [],
    bashAllow: ["pnpm test*"],
    promptFile: "p.md",
    outputKind: null,
    ...over,
  };
}

export const specialist = (over: Partial<AgentRunOptions> = {}) => agentFor(over);
export const qa = (over: Partial<AgentRunOptions> = {}) =>
  agentFor({
    states: ["QA"],
    tools: ["Read", "Glob", "Grep", "Bash"],
    allowedTools: ["mcp__friday__qa_report"],
    ...over,
  });
export const judge = (over: Partial<AgentRunOptions> = {}) =>
  agentFor({ states: ["InReview"], tools: ["Read", "Glob", "Grep"], bashAllow: [], ...over });
