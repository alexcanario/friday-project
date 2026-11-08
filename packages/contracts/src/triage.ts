import { z } from "zod";

export const triageSchema = z.strictObject({
  specialist: z.enum(["backend", "database", "frontend", "infra", "security"]),
  reason: z.string().refine((s) => s.trim() !== ""),
  criteria: z.unknown().optional(),
});

export type Triage = z.infer<typeof triageSchema>;
