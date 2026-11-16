export type CanUseCall = { toolName: string; input: unknown };

export type BuildPluginOptionsInput = {
  cwd: string;
  pluginPath: string;
  maxTurns: number;
  maxBudgetUsd: number;
  env: Record<string, string>;
  recordCanUse?: (call: CanUseCall) => void;
  permissive?: boolean;
};

export type Decision = { behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string };

const READ_ONLY_TOOLS = new Set(["Skill", "Read", "Glob", "Grep", "TodoWrite", "ToolSearch"]);
const norm = (value: string) => value.replaceAll("\\", "/").toLowerCase();

// Rodada permissiva: só o rascunho e os scripts do plugin; AskUserQuestion fica negada e registrada.
export function decidePermissive(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string,
  pluginPath: string,
): Decision {
  const allow = { behavior: "allow" as const, updatedInput: toolInput };
  if (READ_ONLY_TOOLS.has(toolName)) return allow;
  const root = norm(cwd);
  const writable = root.slice(0, root.lastIndexOf("/")); // pasta do rascunho e dos worktrees irmãos
  if (toolName === "Write" || toolName === "Edit") {
    const target = norm(String(toolInput.file_path ?? ""));
    if (target.startsWith(`${writable}/`)) return allow;
  }
  if (toolName === "Bash") {
    const command = norm(String(toolInput.command ?? ""));
    const scripts = `${norm(pluginPath)}/scripts/`;
    const ok = command.includes(scripts) || command.startsWith("git ") || command.includes(`cd "${root}"`);
    if (ok && !/(rm|del|curl|wget|gh)/.test(command)) return allow;
  }
  return { behavior: "deny", message: "canUseTool nega neste spike" };
}

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
      if (input.permissive) return decidePermissive(toolName, toolInput, input.cwd, input.pluginPath);
      return { behavior: "deny" as const, message: "canUseTool nega neste spike" };
    },
  };
}
