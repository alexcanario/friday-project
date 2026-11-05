import { posix, win32 } from "node:path";
import { isBashAllowed } from "./bash-allow.ts";
import type { ToolPolicy } from "./tool-policy.ts";

export type ToolDecision = { allow: true } | { allow: false; reason: string };
export interface ToolCall {
  toolName: string;
  toolInput: unknown;
}

const deny = (reason: string): ToolDecision => ({ allow: false, reason });
const PROTECTED_DIRS = [".friday", ".claude"];

type PathModule = typeof posix;

/** Resolves the deepest existing ancestor with realpath and appends the rest lexically. */
function realOf(policy: ToolPolicy, p: PathModule, path: string): string {
  let current = path;
  const rest: string[] = [];
  for (;;) {
    try {
      return p.join(policy.realpath(current), ...rest);
    } catch {
      const parent = p.dirname(current);
      if (parent === current) return path;
      rest.unshift(p.basename(current));
      current = parent;
    }
  }
}

function relativeInside(p: PathModule, root: string, target: string): string | null {
  const rel = p.relative(root, target);
  if (rel === "") return "";
  if (rel === ".." || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel)) return null;
  return rel;
}

function checkPath(policy: ToolPolicy, raw: string, write: boolean): ToolDecision {
  if (raw === "" || raw !== raw.trim() || raw.startsWith("~")) return deny("caminho inválido");
  const p: PathModule = policy.style === "win32" ? win32 : posix;
  const lexical = p.resolve(policy.worktree, raw);
  const real = realOf(policy, p, lexical);
  const root = realOf(policy, p, p.resolve(policy.worktree));
  const rel = relativeInside(p, root, real);
  if (rel === null || relativeInside(p, p.resolve(policy.worktree), lexical) === null) {
    return deny("caminho fora da worktree");
  }
  if (write) {
    const lexRel = relativeInside(p, p.resolve(policy.worktree), lexical) ?? "";
    for (const r of [rel, lexRel]) {
      const first = r.split(p.sep)[0] ?? "";
      const key = policy.style === "win32" ? first.toLowerCase() : first;
      if (PROTECTED_DIRS.includes(key)) return deny("escrita negada em .friday e .claude");
    }
  }
  return { allow: true };
}

function str(input: Record<string, unknown>, key: string): string | undefined | null {
  const v = input[key];
  if (v === undefined) return undefined;
  return typeof v === "string" ? v : null;
}

function decideBuiltin(policy: ToolPolicy, name: string, input: Record<string, unknown>) {
  const write = name === "Edit" || name === "Write";
  if (name === "Bash") {
    const command = str(input, "command");
    if (typeof command !== "string") return deny("entrada malformada");
    return isBashAllowed(command, policy.bashAllow)
      ? { allow: true as const }
      : deny("Bash negado");
  }
  const checks: Array<string | undefined | null> = [];
  if (name === "Read" || write) {
    const file = str(input, "file_path");
    if (typeof file !== "string") return deny("entrada malformada");
    checks.push(file);
  } else if (name === "Glob") {
    const pattern = str(input, "pattern");
    if (typeof pattern !== "string" || pattern.includes("{")) return deny("padrão inválido");
    checks.push(pattern, str(input, "path"));
  } else if (name === "Grep") {
    if (typeof str(input, "pattern") !== "string") return deny("entrada malformada");
    checks.push(str(input, "path"));
  }
  for (const c of checks) {
    if (c === null) return deny("entrada malformada");
    if (c === undefined) continue;
    const d = checkPath(policy, c, write);
    if (!d.allow) return d;
  }
  return { allow: true as const };
}

export function decideToolCall(policy: ToolPolicy, call: ToolCall): ToolDecision {
  const { toolName, toolInput } = call;
  if (toolName.startsWith("mcp__")) {
    return policy.allowedTools.includes(toolName) ? { allow: true } : deny("ferramenta MCP negada");
  }
  if (!policy.tools.includes(toolName)) return deny("ferramenta fora da ficha");
  if (typeof toolInput !== "object" || toolInput === null || Array.isArray(toolInput)) {
    return deny("entrada malformada");
  }
  return decideBuiltin(policy, toolName, toolInput as Record<string, unknown>);
}
