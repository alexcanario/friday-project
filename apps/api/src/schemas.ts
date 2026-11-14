import { z } from "zod";

export const projectQuery = z.object({ project: z.string().min(1) });

export const issueParams = z.object({ issueId: z.coerce.number().int().positive() });
export const runParams = z.object({ runId: z.string().min(1) });
export const dayParams = z.object({ day: z.iso.date() });
