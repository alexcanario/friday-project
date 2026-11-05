import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRunRequest } from "@friday/application";
import { contractJsonSchema } from "@friday/contracts";

export interface QueryOptionsInput {
  request: AgentRunRequest;
  env: Record<string, string>;
  systemPromptAppend: string;
  abortController: AbortController;
}

export function buildQueryOptions(input: QueryOptionsInput): Options {
  const { request, env, systemPromptAppend, abortController } = input;
  const { agent } = request;
  const options: Options = {
    cwd: request.cwd,
    env,
    model: agent.model,
    tools: agent.tools,
    allowedTools: agent.allowedTools,
    permissionMode: "dontAsk",
    settingSources: [],
    strictMcpConfig: true,
    maxTurns: agent.maxTurns,
    maxBudgetUsd: agent.maxBudgetUsd,
    systemPrompt: { type: "preset", preset: "claude_code", append: systemPromptAppend },
    persistSession: false,
    abortController,
  };
  if (agent.outputKind != null) {
    options.outputFormat = { type: "json_schema", schema: contractJsonSchema(agent.outputKind) };
  }
  return options;
}
