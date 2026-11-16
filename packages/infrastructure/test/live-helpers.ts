import type { AgentConfig } from "@friday/contracts";

type InitLike = { tools: string[]; mcp_servers: { name: string; status?: string }[] };

/** True when the SDK `system/init` exposes exactly the tools of the agent sheet and only the friday server. */
export function initMatchesSheet(
  init: InitLike,
  agent: Pick<AgentConfig, "tools" | "mcp_tools" | "output">,
): boolean {
  const expected = new Set<string>([
    ...agent.tools,
    ...agent.mcp_tools.map((t) => `mcp__friday__${t}`),
    ...(agent.output === undefined ? [] : ["StructuredOutput"]),
  ]);
  const actual = new Set(init.tools);
  const sameTools = actual.size === expected.size && [...expected].every((t) => actual.has(t));
  const servers = init.mcp_servers.map((s) => s.name);
  return sameTools && servers.length === 1 && servers[0] === "friday";
}

/** True when the first `200:` result is later followed by a `409:` and no second `200:` appears. */
export function secondCallDenied(toolResultTexts: string[]): boolean {
  const first = toolResultTexts.findIndex((t) => t.startsWith("200:"));
  if (first < 0) return false;
  const rest = toolResultTexts.slice(first + 1);
  return rest.some((t) => t.startsWith("409:")) && !rest.some((t) => t.startsWith("200:"));
}
