export async function denyWrite(input: { tool_name?: string }, _toolUseID?: string, _ctx?: unknown) {
  if (input.tool_name !== "Write") return {};
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse" as const,
      permissionDecision: "deny" as const,
      permissionDecisionReason: "Write é proibido neste spike",
    },
  };
}
