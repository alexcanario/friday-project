import { z } from "zod";

/** Response of `GET /runs/:runId/review`: the Judge verdict and the PR number of a run (D81, D108). */
export const runReview = z.object({
  judge: z
    .object({
      outcome: z.enum(["approve", "reject", "changes_requested"]),
      reviewId: z.number().int(),
      feedback: z.string().nullable(),
      at: z.string(),
    })
    .nullable(),
  pr: z.object({ number: z.number().int().positive() }).nullable(),
});

export type RunReview = z.infer<typeof runReview>;
