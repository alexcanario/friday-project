import type { AgentConfig, RunFinished } from "@friday/contracts";
import type { IssueState } from "@friday/domain";
import type { AgentRunOptions } from "./agent-run-options.ts";

export interface AgentRunRequest {
  cwd: string;
  prompt: string;
  configRoot: string;
  agent: AgentRunOptions;
  /** Asks the runtime to expose the `friday` MCP server (result tools) to this run. */
  friday?: {
    runId: string;
    agent: Pick<AgentConfig, "states" | "mcp_tools">;
    getIssueState: () => IssueState;
  };
}

export interface AgentRuntime {
  /** Whatever happens in the run becomes `status`; the promise never rejects for a run failure. */
  run(request: AgentRunRequest): Promise<RunFinished>;
}
