import type { AgentConfig } from "@friday/contracts";

export interface AgentRunOptions {
  model: AgentConfig["model"];
  maxBudgetUsd: number;
  maxTurns: number;
  timeoutMs: number;
  tools: AgentConfig["tools"];
  allowedTools: string[];
  bashAllow: string[];
  promptFile: string;
  outputKind: AgentConfig["output"] | null;
}

export function toAgentRunOptions(agent: AgentConfig): AgentRunOptions {
  return {
    model: agent.model,
    maxBudgetUsd: agent.max_budget_usd,
    maxTurns: agent.max_turns,
    timeoutMs: agent.timeout_s * 1000,
    tools: agent.tools,
    allowedTools: agent.mcp_tools.map((name) => `mcp__friday__${name}`),
    bashAllow: agent.bash_allow ?? [],
    promptFile: agent.prompt_file,
    outputKind: agent.output ?? null,
  };
}
