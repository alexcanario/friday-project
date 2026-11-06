import { z } from "zod";

const text = z.string().refine((s) => s.trim() !== "");
const positiveInt = z.number().int().positive();
const positive = z.number().positive();
const model = z.enum(["haiku", "sonnet", "opus"]);

const RISK_RULES = [
  "migrations",
  "infra",
  "ci",
  "dependencies",
  "secrets",
  "agent_config",
  "size",
] as const;

export const factoryConfigSchema = z.strictObject({
  schemaVersion: z.literal("friday/v1"),
  enabled: z.boolean(),
  repository: z.strictObject({ owner: text, name: text, base: text }),
  verify: z.strictObject({ command: text, timeout_s: positiveInt }),
  flow: z.strictObject({
    screen_paths: z.array(z.string()),
    pr_evidence: z.boolean(),
    triage: z.strictObject({ model, max_budget_usd: positive }),
  }),
  risk: z.strictObject({
    rules: z.array(z.enum(RISK_RULES)).refine((rules) => new Set(rules).size === rules.length),
    max_changed_lines: positiveInt,
    max_changed_files: positiveInt,
  }),
  pull_requests: z.strictObject({
    merge: z.enum(["manual", "auto"]),
    author_token_env: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .optional(),
    review_token_env: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .optional(),
  }),
  limits: z.strictObject({
    per_issue_usd: positive,
    per_day_usd: positive,
    approval_expires_min: positiveInt,
    max_concurrent_runs: positiveInt.optional(),
  }),
  secrets: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)),
});

export type FactoryConfig = z.infer<typeof factoryConfigSchema>;
