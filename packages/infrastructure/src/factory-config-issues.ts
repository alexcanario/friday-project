import { configProblem, type ConfigProblem } from "@friday/application";
import { hasSecretPrefix } from "./factory-config-secrets.ts";
import {
  keyLine,
  valueLine,
  valueSource,
  type ParsedYaml,
  type PathKey,
} from "./factory-config-yaml.ts";

export interface SchemaIssue {
  code: string;
  path: PropertyKey[];
  keys?: string[];
}

const subject = (path: PathKey[]) => (path.length === 0 ? "raiz" : path.join("."));

function valueAt(root: unknown, path: PathKey[]): unknown {
  let node = root;
  for (const key of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<PathKey, unknown>)[key];
  }
  return node;
}

function isMissingKey(p: ParsedYaml, path: PathKey[]): boolean {
  const key = path[path.length - 1];
  if (key === undefined) return false;
  const parent = valueAt(p.value, path.slice(0, -1));
  return (
    parent !== null && typeof parent === "object" && !Array.isArray(parent) && !(key in parent)
  );
}

function requiredKeyLine(p: ParsedYaml, path: PathKey[]): number {
  if (path.length <= 1) return 1;
  const parentKey = path[path.length - 2] as PathKey;
  const grand = path.slice(0, -2);
  if (typeof parentKey === "number") return valueLine(p, path.slice(0, -1));
  return keyLine(p, grand, parentKey) ?? valueLine(p, path.slice(0, -1));
}

function fromIssue(p: ParsedYaml, file: string, issue: SchemaIssue): ConfigProblem[] {
  const path = issue.path.filter((k): k is PathKey => typeof k !== "symbol");
  if (issue.code === "unrecognized_keys") {
    return (issue.keys ?? []).map((key) =>
      configProblem(
        "unknown_key",
        file,
        keyLine(p, path, key) ?? valueLine(p, path),
        subject(path),
      ),
    );
  }
  if (isMissingKey(p, path)) {
    return [configProblem("required_key", file, requiredKeyLine(p, path), subject(path))];
  }
  if (hasSecretPrefix(valueSource(p, path))) return [];
  const line = valueLine(p, path);
  const isToolItem = path.length === 2 && (path[0] === "tools" || path[0] === "mcp_tools");
  if (isToolItem) return [configProblem("unknown_tool", file, line, subject(path))];
  if (path[0] === "secrets" && path.length === 2)
    return [configProblem("secret_value", file, line)];
  return [configProblem("invalid_value", file, line, subject(path))];
}

function isEmptyStates(raw: unknown): boolean {
  return raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0);
}

/** Maps Zod issues to located problems, applying the classification rules. */
export function issuesToProblems(
  p: ParsedYaml,
  file: string,
  issues: SchemaIssue[],
  kind: "factory" | "agent",
): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const isMap = p.value !== null && typeof p.value === "object" && !Array.isArray(p.value);
  const root = isMap ? p.value : {};
  const states = (root as Record<string, unknown>)["states"];
  const secrets = (root as Record<string, unknown>)["secrets"];
  let handled = false;
  if (kind === "agent" && isMap && isEmptyStates(states)) {
    problems.push(configProblem("agent_without_state", file, keyLine(p, [], "states") ?? 1));
    handled = true;
  }
  const secretsShape =
    typeof secrets === "string" ||
    (typeof secrets === "object" && secrets !== null && !Array.isArray(secrets));
  if (kind === "factory" && secretsShape) {
    problems.push(configProblem("secret_value", file, valueLine(p, ["secrets"])));
  }
  for (const issue of issues) {
    const head = issue.path[0];
    if (handled && head === "states") continue;
    if (kind === "factory" && secretsShape && head === "secrets") continue;
    problems.push(...fromIssue(p, file, issue));
  }
  return problems;
}
