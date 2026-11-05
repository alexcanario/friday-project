import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRunRequest, ResultStore, RunLookup } from "@friday/application";
import type { createFridayMcpServer } from "./friday-mcp-server.ts";

const PREFIX = "mcp__friday__";

export interface FridayMcpDeps {
  runs?: RunLookup;
  results?: ResultStore;
  createMcpServer: typeof createFridayMcpServer;
}

/** `null` means misconfigured; `undefined` means the request does not ask for the server. */
export function buildFridayMcpServers(
  request: AgentRunRequest,
  deps: FridayMcpDeps,
): Options["mcpServers"] | null | undefined {
  const friday = request.friday;
  if (friday === undefined) return undefined;
  const { runs, results } = deps;
  if (runs === undefined || results === undefined) return null;
  const wanted = friday.agent.mcp_tools.map((t) => `${PREFIX}${t}`).sort();
  const allowed = request.agent.allowedTools.filter((t) => t.startsWith(PREFIX)).sort();
  if (wanted.length !== allowed.length || wanted.some((t, i) => t !== allowed[i])) return null;
  try {
    const { server } = deps.createMcpServer({
      runId: friday.runId,
      agent: friday.agent,
      getIssueState: friday.getIssueState,
      runs,
      results,
    });
    return { friday: server };
  } catch {
    return null;
  }
}
