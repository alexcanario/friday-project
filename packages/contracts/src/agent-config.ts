import { z } from "zod";

export const BUILTIN_TOOLS = ["Read", "Glob", "Grep", "Bash", "Edit", "Write"] as const;
export const MCP_TOOLS = [
  "criteria_set",
  "work_report",
  "git_push",
  "pr_create",
  "qa_report",
  "pr_diff",
  "review_verdict",
  "issue_comment",
] as const;
export const AGENT_STATES = ["InProgress", "QA", "InReview"] as const;

const text = z.string().refine((s) => s.trim() !== "");
const positiveInt = z.number().int().positive();

export const agentConfigSchema = z.strictObject({
  role: z.string().regex(/^[a-z][a-z0-9-]*$/),
  states: z.array(z.enum(AGENT_STATES)).min(1),
  model: z.enum(["haiku", "sonnet", "opus"]),
  max_budget_usd: z.number().positive(),
  max_turns: positiveInt,
  timeout_s: positiveInt,
  tools: z.array(z.enum(BUILTIN_TOOLS)),
  mcp_tools: z.array(z.enum(MCP_TOOLS)),
  prompt_file: text,
  bash_allow: z.array(z.string()).optional(),
  output: z
    .enum(["qaReport", "reviewVerdict", "triage", "criteria", "workReport", "diagnosis"])
    .optional(),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;
