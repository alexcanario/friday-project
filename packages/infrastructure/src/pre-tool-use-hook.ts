import type { HookCallback, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { ToolDenialSink } from "@friday/application";
import { decideToolCall, type ToolDecision } from "./tool-decision.ts";
import type { ToolPolicy } from "./tool-policy.ts";

/** The SDK hook timeout is 5 s; our own deadline must win the race. */
export const HOOK_TIMEOUT_SECONDS = 5;
export const HOOK_TIMEOUT_MS = 4500;

export interface PreToolUseHookInput {
  policy: ToolPolicy;
  sink: ToolDenialSink;
  timeoutMs: number;
  decide?: (
    policy: ToolPolicy,
    call: { toolName: string; toolInput: unknown },
  ) => ToolDecision | Promise<ToolDecision>;
}

export const denialMessage = (toolName: string): string =>
  `Ferramenta ${toolName} negada pela política de permissões.`;

const TIMED_OUT = Symbol("timed out");

const denyOutput = (reason: string): HookJSONOutput => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: reason,
  },
});

async function decideWithin(
  input: PreToolUseHookInput,
  call: { toolName: string; toolInput: unknown },
): Promise<ToolDecision | typeof TIMED_OUT> {
  const decide = input.decide ?? decideToolCall;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), input.timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => decide(input.policy, call)), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Fails closed: a slow or throwing decision, or a throwing sink, still denies the call. */
export function buildPreToolUseHook(input: PreToolUseHookInput): HookCallback {
  return async (hookInput) => {
    const raw = hookInput as { tool_name?: unknown; tool_input?: unknown; tool_use_id?: unknown };
    const toolName = typeof raw.tool_name === "string" ? raw.tool_name : "desconhecida";
    const toolUseId = typeof raw.tool_use_id === "string" ? raw.tool_use_id : "";
    let reason: string | null;
    try {
      const decision = await decideWithin(input, { toolName, toolInput: raw.tool_input });
      if (decision === TIMED_OUT) reason = "Tempo esgotado na política de permissões.";
      else reason = decision.allow ? null : denialMessage(toolName);
    } catch {
      reason = "Erro na política de permissões.";
    }
    if (reason === null) return {};
    try {
      input.sink.record({ toolName, toolUseId });
    } catch {
      // The denial stands even when the sink fails.
    }
    return denyOutput(reason);
  };
}
