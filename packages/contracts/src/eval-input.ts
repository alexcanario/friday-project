import { z } from "zod";

export const evalRunSchema = z.object({
  itemId: z.string(),
  status: z.enum(["done", "failed"]),
  costUsd: z.number().nonnegative().nullable(),
  rounds: z.number().int().nonnegative(),
});

export const evalRunsSchema = z.array(evalRunSchema);

export const evalBaselineSchema = z.object({
  doneRate: z.number().min(0).max(1),
});

export type EvalRunInput = z.infer<typeof evalRunSchema>;
export type EvalBaselineInput = z.infer<typeof evalBaselineSchema>;
