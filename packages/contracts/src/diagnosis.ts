import { z } from "zod";

export const diagnosisSchema = z.strictObject({
  issue_number: z.number().int().min(1),
  root_cause: z.string().min(20),
  evidence: z.array(z.string()).min(1),
  proposed_change: z.string(),
  risk: z.enum(["low", "medium", "high"]),
  affected_components: z.array(z.string()),
  load_relevant: z.boolean(),
  jev_score: z.number().optional(),
});

export type Diagnosis = z.infer<typeof diagnosisSchema>;
