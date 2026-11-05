import { z } from "zod";

export const RUN_STATUSES = [
  "succeeded",
  "budget_exceeded",
  "turns_exceeded",
  "invalid_output",
  "timeout",
  "misconfigured",
  "failed",
] as const;

const count = z.number().int().min(0);

/** null in cost, tokens, turns and duration means unknown (no SDK result message), not zero. */
export const runFinishedSchema = z.strictObject({
  status: z.enum(RUN_STATUSES),
  subtype: z.string().nullable(),
  model: z.string().nullable(),
  costUsd: z.number().min(0).nullable(),
  tokens: z
    .strictObject({
      input: count,
      output: count,
      cacheRead: count,
      cacheCreation: count,
    })
    .nullable(),
  numTurns: count.nullable(),
  durationMs: count.nullable(),
  output: z.unknown().nullable(),
  violations: z.array(z.strictObject({ code: z.string(), path: z.string(), message: z.string() })),
});

export type RunFinished = z.infer<typeof runFinishedSchema>;
