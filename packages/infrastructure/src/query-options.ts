import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRunRequest, ToolDenialSink } from "@friday/application";
import { contractJsonSchema } from "@friday/contracts";
import {
  buildPreToolUseHook,
  denialMessage,
  HOOK_TIMEOUT_MS,
  HOOK_TIMEOUT_SECONDS,
} from "./pre-tool-use-hook.ts";
import type { ToolPolicy } from "./tool-policy.ts";

export interface QueryOptionsInput {
  request: AgentRunRequest;
  env: Record<string, string>;
  systemPromptAppend: string;
  abortController: AbortController;
  policy: ToolPolicy;
  sink: ToolDenialSink;
  mcpServers?: Options["mcpServers"];
}

/** The hook is the real gate: native tools are pre-approved so it decides them, Bash only with a list. */
function preApproved(agent: AgentRunRequest["agent"]): string[] {
  const native = agent.tools.filter((t) => t !== "Bash" || agent.bashAllow.length > 0);
  return [...new Set([...agent.allowedTools, ...native])];
}

export function buildQueryOptions(input: QueryOptionsInput): Options {
  const { request, env, systemPromptAppend, abortController, policy, sink } = input;
  const { agent } = request;
  const options: Options = {
    cwd: request.cwd,
    env,
    model: agent.model,
    tools: agent.tools,
    allowedTools: preApproved(agent),
    permissionMode: "dontAsk",
    settingSources: [],
    strictMcpConfig: true,
    maxTurns: agent.maxTurns,
    maxBudgetUsd: agent.maxBudgetUsd,
    systemPrompt: { type: "preset", preset: "claude_code", append: systemPromptAppend },
    persistSession: false,
    abortController,
    hooks: {
      PreToolUse: [
        {
          hooks: [buildPreToolUseHook({ policy, sink, timeoutMs: HOOK_TIMEOUT_MS })],
          onFailure: "block",
          timeout: HOOK_TIMEOUT_SECONDS,
        },
      ],
    },
    // Defense in depth: only runs outside dontAsk.
    canUseTool: async (toolName, _input, opts) => {
      sink.record({ toolName, toolUseId: opts.toolUseID });
      return { behavior: "deny", message: denialMessage(toolName) };
    },
  };
  if (input.mcpServers !== undefined) options.mcpServers = input.mcpServers;
  if (agent.outputKind != null) {
    options.outputFormat = { type: "json_schema", schema: contractJsonSchema(agent.outputKind) };
  }
  return options;
}
