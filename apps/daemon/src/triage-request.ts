import { isAbsolute } from "node:path";
import type { AgentRunRequest, IssueSummary } from "@friday/application";
import type { AgentConfig } from "@friday/contracts";

export type TriageAgentConfig = { maxTurns: number; timeoutMs: number; promptFile: string };

export type TriageRequestInput = {
  issue: IssueSummary;
  flow: { model: AgentConfig["model"]; maxBudgetUsd: number };
  agentConfig: TriageAgentConfig;
  cwd: string;
  configRoot: string;
};

const positiveInt = (n: number): boolean => Number.isInteger(n) && n > 0;

/** Throws when the agent config cannot describe a triage run. */
export function assertTriageAgentConfig(agentConfig: TriageAgentConfig): void {
  const { maxTurns, timeoutMs, promptFile } = agentConfig;
  const valid =
    positiveInt(maxTurns) &&
    positiveInt(timeoutMs) &&
    promptFile !== "" &&
    !isAbsolute(promptFile) &&
    !promptFile.startsWith("/") &&
    !promptFile.split(/[\\/]/).includes("..");
  if (!valid) throw new Error("A ficha da triagem é inválida.");
}

/** Builds the triage run: no tools and no `friday` server; the output comes from the structured format. */
export function buildTriageRequest(input: TriageRequestInput): AgentRunRequest {
  const { issue, flow, agentConfig } = input;
  assertTriageAgentConfig(agentConfig);
  return {
    cwd: input.cwd,
    configRoot: input.configRoot,
    prompt: `Issue #${issue.number}: ${issue.title}\n\n${issue.body}`,
    agent: {
      model: flow.model,
      states: [],
      maxBudgetUsd: flow.maxBudgetUsd,
      maxTurns: agentConfig.maxTurns,
      timeoutMs: agentConfig.timeoutMs,
      tools: [],
      allowedTools: [],
      bashAllow: [],
      promptFile: agentConfig.promptFile,
      outputKind: "triage",
    },
  };
}
