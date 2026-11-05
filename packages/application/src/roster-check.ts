import { AGENT_STATES, triageSchema, type AgentConfig } from "@friday/contracts";
import { configProblem, type ConfigProblem } from "./config-problem.ts";

export function checkRoster(agents: AgentConfig[]): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  for (const state of AGENT_STATES) {
    if (!agents.some((a) => a.states.includes(state))) {
      problems.push(configProblem("state_without_agent", "agents", 1, state));
    }
  }
  for (const role of triageSchema.shape.specialist.options) {
    if (!agents.some((a) => a.role === role && a.states.includes("InProgress"))) {
      problems.push(configProblem("specialist_without_agent", "agents", 1, role));
    }
  }
  return problems;
}
