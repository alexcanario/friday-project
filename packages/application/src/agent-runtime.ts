import type { RunFinished } from "@friday/contracts";
import type { AgentRunOptions } from "./agent-run-options.ts";

export interface AgentRunRequest {
  cwd: string;
  prompt: string;
  configRoot: string;
  agent: AgentRunOptions;
}

export interface AgentRuntime {
  /** Whatever happens in the run becomes `status`; the promise never rejects for a run failure. */
  run(request: AgentRunRequest): Promise<RunFinished>;
}
