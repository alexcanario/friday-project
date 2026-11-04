import { z } from "zod";

export const triageSchema = z.strictObject({
  specialist: z.enum(["backend", "database", "frontend", "infra", "security"]),
  reason: z.string().refine((s) => s.trim() !== ""),
});

export type Triage = z.infer<typeof triageSchema>;
