import { isAbsolute } from "node:path";
import type { AgentRunRequest, IssueSummary } from "@friday/application";
import type { AgentConfig } from "@friday/contracts";

export type TriageFicha = { maxTurns: number; timeoutMs: number; promptFile: string };

export type TriageRequestInput = {
  issue: IssueSummary;
  flow: { model: AgentConfig["model"]; maxBudgetUsd: number };
  ficha: TriageFicha;
  cwd: string;
  configRoot: string;
};

const positiveInt = (n: number): boolean => Number.isInteger(n) && n > 0;

/** Throws when the ficha cannot describe a triage run. */
export function assertTriageFicha(ficha: TriageFicha): void {
  const { maxTurns, timeoutMs, promptFile } = ficha;
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
  const { issue, flow, ficha } = input;
  assertTriageFicha(ficha);
  return {
    cwd: input.cwd,
    configRoot: input.configRoot,
    prompt: `Issue #${issue.number}: ${issue.title}\n\n${issue.body}`,
    agent: {
      model: flow.model,
      states: [],
      maxBudgetUsd: flow.maxBudgetUsd,
      maxTurns: ficha.maxTurns,
      timeoutMs: ficha.timeoutMs,
      tools: [],
      allowedTools: [],
      bashAllow: [],
      promptFile: ficha.promptFile,
      outputKind: "triage",
    },
  };
}
