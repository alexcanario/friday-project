import { readlinkSync, realpathSync } from "node:fs";
import type { AgentRunOptions } from "@friday/application";

export type PathStyle = "win32" | "posix";

export interface ToolPolicy {
  tools: readonly string[];
  allowedTools: readonly string[];
  bashAllow: readonly string[];
  /** The SDK's StructuredOutput tool is allowed only for agents with an output contract. */
  structuredOutput?: boolean;
  worktree: string;
  style: PathStyle;
  realpath: (path: string) => string;
  /** Throws when the path is not a symbolic link. */
  readlink: (path: string) => string;
}

export type BuildToolPolicyResult =
  { ok: true; policy: ToolPolicy } | { ok: false; forbiddenTools: string[] };

const READ_ONLY = ["Read", "Glob", "Grep"];
const PROFILES = {
  judge: READ_ONLY,
  qa: [...READ_ONLY, "Bash"],
  specialist: [...READ_ONLY, "Edit", "Write", "Bash"],
};

function profileFor(states: AgentRunOptions["states"]): string[] {
  if (states.includes("InReview")) return PROFILES.judge;
  if (states.includes("QA")) return PROFILES.qa;
  return PROFILES.specialist;
}

export function styleOf(worktree: string): PathStyle {
  return /^[A-Za-z]:[\\/]/.test(worktree) ? "win32" : "posix";
}

export function buildToolPolicy(
  agent: AgentRunOptions,
  worktree: string,
  deps: { realpath?: (path: string) => string; readlink?: (path: string) => string } = {},
): BuildToolPolicyResult {
  const profile = profileFor(agent.states);
  const forbiddenTools = agent.tools.filter((t) => !profile.includes(t));
  if (forbiddenTools.length > 0) return { ok: false, forbiddenTools };
  return {
    ok: true,
    policy: {
      tools: agent.tools,
      allowedTools: agent.allowedTools,
      bashAllow: agent.bashAllow,
      structuredOutput: agent.outputKind != null,
      worktree,
      style: styleOf(worktree),
      realpath: deps.realpath ?? ((p) => realpathSync(p)),
      readlink: deps.readlink ?? ((p) => readlinkSync(p)),
    },
  };
}
