import { z } from "zod";

const titled = z.strictObject({ number: z.number().int(), title: z.string() });

export const nightDigestSchema = z.strictObject({
  reportIssue: z.number().int(),
  since: z.iso.datetime().nullable(),
  merges: z.array(
    z.strictObject({ issue: z.number().int().nullable(), pr: z.number().int(), title: z.string() }),
  ),
  stuckPrs: z.array(
    z.strictObject({
      pr: z.number().int(),
      issue: z.number().int(),
      gates: z.array(z.string()),
      reason: z.string(),
    }),
  ),
  nightStop: z.boolean(),
  ready: z.array(titled),
  review: z.array(titled),
  phases: z.strictObject({ A: z.boolean(), B: z.boolean() }),
});

export type NightDigest = z.infer<typeof nightDigestSchema>;
