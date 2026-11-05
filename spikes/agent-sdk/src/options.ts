import { denyWrite } from "./hooks.ts";
import { resultJsonSchema } from "./schema.ts";
import { SPIKE_SERVER_NAME, SPIKE_TOOL_FULL_NAME, createSpikeTools } from "./tools.ts";

export type CanUseCall = { toolName: string; input: unknown };

export type BuildOptionsInput = {
  cwd: string;
  env: Record<string, string>;
  maxTurns: number;
  maxBudgetUsd: number;
  exposeWrite?: boolean;
  withHook?: boolean;
  recordCanUse?: (call: CanUseCall) => void;
};

const READ_TOOLS = ["Read", "Glob", "Grep"];

export function buildOptions(input: BuildOptionsInput) {
  if (!Number.isInteger(input.maxTurns) || input.maxTurns < 1) {
    throw new Error("maxTurns deve ser inteiro >= 1");
  }
  if (!(input.maxBudgetUsd > 0)) throw new Error("maxBudgetUsd deve ser > 0");
  const spike = createSpikeTools();
  return {
    cwd: input.cwd,
    env: input.env,
    tools: input.exposeWrite ? [...READ_TOOLS, "Write"] : [...READ_TOOLS],
    allowedTools: [...READ_TOOLS, SPIKE_TOOL_FULL_NAME],
    permissionMode: "dontAsk" as const,
    settingSources: ["project" as const],
    strictMcpConfig: true,
    maxTurns: input.maxTurns,
    maxBudgetUsd: input.maxBudgetUsd,
    outputFormat: { type: "json_schema" as const, schema: resultJsonSchema() },
    hooks:
      input.withHook === false
        ? undefined
        : { PreToolUse: [{ matcher: "Write", hooks: [denyWrite] }] },
    mcpServers: { [SPIKE_SERVER_NAME]: spike.server },
    canUseTool: async (
      toolName: string,
      toolInput: Record<string, unknown>,
      _ctx: { signal: AbortSignal; toolUseID: string },
    ) => {
      input.recordCanUse?.({ toolName, input: toolInput });
      return { behavior: "deny" as const, message: "canUseTool nega neste spike" };
    },
  };
}
