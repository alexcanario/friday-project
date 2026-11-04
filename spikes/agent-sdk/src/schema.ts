import { z } from "zod";

export const resultSchema = z.object({
  summary: z.string().min(1),
  files: z.array(z.string()),
  count: z.number().int().min(1),
});

export type SpikeResult = z.infer<typeof resultSchema>;

export function resultJsonSchema() {
  return z.toJSONSchema(resultSchema, { target: "draft-7" });
}
