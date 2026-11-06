import { z } from "zod";

export const projectQuery = z.object({ project: z.string().min(1) });

export const healthResponse = z.object({ status: z.literal("ok") });

export const issueParams = z.object({ issueId: z.coerce.number().int().positive() });
export const runParams = z.object({ runId: z.string().min(1) });
export const dayParams = z.object({ day: z.iso.date() });

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
});

export const daySum = z.object({
  costUsd: z.number(),
  anyCostUnknown: z.boolean(),
});

export const errorResponse = z.object({ message: z.string() });
