import { z } from "zod";

const variantId = z.string().regex(/^[a-z][a-z0-9-]*$/);
const kind = z.enum(["backend", "frontend", "cross"]);

export const experimentRunSchema = z.strictObject({
  itemId: z.string(),
  kind,
  variant: variantId,
  status: z.enum(["done", "failed"]),
  costUsd: z.number().nonnegative().nullable(),
  rounds: z.number().int().nonnegative(),
  judgeFirstRound: z.boolean(),
  durationS: z.number().nonnegative(),
  peakContextTokens: z.number().int().nonnegative().nullable(),
});

export const experimentRunsSchema = z.array(experimentRunSchema);

const hasUniqueIds = (items: readonly { id: string }[]): boolean =>
  new Set(items.map((i) => i.id)).size === items.length;

export const experimentVariantsSchema = z
  .array(z.strictObject({ id: variantId, title: z.string(), description: z.string() }))
  .min(1)
  .refine(hasUniqueIds, { message: "variant ids must be unique" });

export const experimentIssuesSchema = z
  .array(
    z.strictObject({
      id: z.string(),
      kind,
      title: z.string(),
      body: z.string(),
      criteria: z.array(z.string().min(1)).min(1),
    }),
  )
  .refine(hasUniqueIds, { message: "issue ids must be unique" })
  .refine((items) => kind.options.every((k) => items.some((i) => i.kind === k)), {
    message: "at least one issue of each kind is required",
  });

export type ExperimentRun = z.infer<typeof experimentRunSchema>;
export type ExperimentKind = ExperimentRun["kind"];
