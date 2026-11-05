export type CanUseCall = { toolName: string; input: unknown };

export type BuildPluginOptionsInput = {
  cwd: string;
  pluginPath: string;
  maxTurns: number;
  maxBudgetUsd: number;
  env: Record<string, string>;
  recordCanUse?: (call: CanUseCall) => void;
};

export function buildPrompt(args: string): string {
  return `/agile:autopilot ${args}`;
}

export function buildPluginOptions(input: BuildPluginOptionsInput) {
  if (!input.pluginPath) throw new Error("plugin ausente");
  if (!Number.isInteger(input.maxTurns) || input.maxTurns < 1) {
    throw new Error("maxTurns deve ser inteiro >= 1");
  }
  if (!(input.maxBudgetUsd > 0)) throw new Error("maxBudgetUsd deve ser > 0");
  return {
    cwd: input.cwd,
    env: input.env,
    settingSources: [] as const,
    plugins: [{ type: "local" as const, path: input.pluginPath }],
    permissionMode: "default" as const,
    maxTurns: input.maxTurns,
    maxBudgetUsd: input.maxBudgetUsd,
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
