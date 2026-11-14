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

export const healthResponse = z.object({ status: z.literal("ok") });

export const issueItem = z.object({
  issueId: z.number().int(),
  state: z.string(),
  heldReason: z.string().nullable(),
});

export const transitionItem = z.object({
  seq: z.number().int(),
  at: z.string(),
  actor: z.string(),
  runId: z.string().nullable(),
  from: z.string(),
  to: z.string(),
  trigger: z.string(),
  heldReason: z.string().nullable(),
});

export const runItem = z.object({
  id: z.string(),
  issueId: z.number().int(),
  phase: z.string().nullable(),
  status: z.enum(["running", "succeeded", "failed", "canceled_by_reconciliation"]),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  costUsd: z.number().nullable(),
  numTurns: z.number().int().nullable(),
});

export const daySum = z.object({
  costUsd: z.number(),
  anyCostUnknown: z.boolean(),
});

export const errorResponse = z.object({ message: z.string() });

export const approvalItem = z.object({
  id: z.string(),
  issueId: z.number().int(),
  pr: z.number().int(),
  headSha: z.string(),
  tier: z.enum(["low", "high", "unclassified"]),
  requestedAt: z.number().int(),
  expiresAt: z.number().int(),
});

/** Response of `GET /status`: the saved `enabled` flag (null when never saved) and the breaker state. */
export const statusResponse = z.object({
  enabled: z.boolean().nullable(),
  breaker: z.object({
    open: z.boolean(),
    openedAt: z.string().nullable(),
    failures: z.array(z.string()),
  }),
});

export type StatusResponse = z.infer<typeof statusResponse>;
export type HealthResponse = z.infer<typeof healthResponse>;
export type IssueItem = z.infer<typeof issueItem>;
export type TransitionItem = z.infer<typeof transitionItem>;
export type RunItem = z.infer<typeof runItem>;
export type DaySum = z.infer<typeof daySum>;
export type ErrorResponse = z.infer<typeof errorResponse>;
export type ApprovalItem = z.infer<typeof approvalItem>;
