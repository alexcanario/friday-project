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

const MAX_LINK_HOPS = 16;

/** Link target of `path`, or null when it is not a (dangling) symbolic link. */
function linkTarget(policy: ToolPolicy, p: PathModule, path: string): string | null {
  try {
    return p.resolve(p.dirname(path), policy.readlink(path));
  } catch {
    return null;
  }
}

/** Resolves the deepest existing ancestor with realpath, following dangling links. */
function realOf(policy: ToolPolicy, p: PathModule, path: string, hops = 0): string {
  let current = path;
  const rest: string[] = [];
  for (;;) {
    try {
      return p.join(policy.realpath(current), ...rest);
    } catch {
      const target = linkTarget(policy, p, current);
      if (target !== null) {
        if (hops >= MAX_LINK_HOPS) throw new Error("too many links");
        return p.join(realOf(policy, p, target, hops + 1), ...rest);
      }
      const parent = p.dirname(current);
      if (parent === current) return path;
      rest.unshift(p.basename(current));
      current = parent;
    }
  }
}

/** Windows ignores trailing dots/spaces, expands 8.3 short names and opens streams after `:`. */
function hasWin32Alias(raw: string): boolean {
  if (raw.replace(/^[A-Za-z]:/, "").includes(":")) return true;
  return raw.split(/[\\/]/).some((seg) => {
    if (seg === "." || seg === "..") return false;
    return /[. ]$/.test(seg) || seg.includes("~");
  });
}

function relativeInside(p: PathModule, root: string, target: string): string | null {
  const rel = p.relative(root, target);
  if (rel === "") return "";
  if (rel === ".." || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel)) return null;
  return rel;
}

function checkPath(policy: ToolPolicy, raw: string, write: boolean): ToolDecision {
  if (raw === "" || raw !== raw.trim() || raw.startsWith("~")) return deny("caminho inválido");
  if (policy.style === "win32" && hasWin32Alias(raw)) return deny("caminho inválido");
  const p: PathModule = policy.style === "win32" ? win32 : posix;
  const lexical = p.resolve(policy.worktree, raw);
  let real: string;
  let root: string;
  try {
    real = realOf(policy, p, lexical);
    root = realOf(policy, p, p.resolve(policy.worktree));
  } catch {
    return deny("caminho não resolvido");
  }
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
    if (pattern.split(/[\\/]/).includes("..")) return deny("padrão inválido");
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
  if (typeof toolInput !== "object" || toolInput === null || Array.isArray(toolInput)) {
    return deny("entrada malformada");
  }
  if (toolName.startsWith("mcp__")) {
    return policy.allowedTools.includes(toolName) ? { allow: true } : deny("ferramenta MCP negada");
  }
  if (toolName === "StructuredOutput" && policy.structuredOutput === true) return { allow: true };
  if (!policy.tools.includes(toolName)) return deny("ferramenta fora da ficha");
  return decideBuiltin(policy, toolName, toolInput as Record<string, unknown>);
}
