import { AGENT_STATES, type AgentConfig } from "@friday/contracts";
import { configProblem, type ConfigProblem } from "./config-problem.ts";

const REQUIRED_SPECIALIST = "backend";

export function checkRoster(agents: AgentConfig[]): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  for (const state of AGENT_STATES) {
    if (!agents.some((a) => a.states.includes(state))) {
      problems.push(configProblem("state_without_agent", "agents", 1, state));
    }
  }
  // First version has only the backend specialist (D70, D84).
  if (!agents.some((a) => a.role === REQUIRED_SPECIALIST && a.states.includes("InProgress"))) {
    problems.push(configProblem("specialist_without_agent", "agents", 1, REQUIRED_SPECIALIST));
  }
  return problems;
}
