import { z } from "zod";

const text = z.string().refine((s) => s.trim() !== "");
const positiveInt = z.number().int().positive();

/** Card of the triage run (D78): no states, no output, and no tools of any kind. */
export const triageAgentConfigSchema = z.strictObject({
  role: z.literal("triage"),
  model: z.enum(["haiku", "sonnet", "opus"]),
  max_budget_usd: z.number().positive(),
  max_turns: positiveInt,
  timeout_s: positiveInt,
  tools: z.tuple([]),
  mcp_tools: z.tuple([]),
  bash_allow: z.tuple([]),
  prompt_file: text,
});

export type TriageAgentConfig = z.infer<typeof triageAgentConfigSchema>;
