import { z } from "zod";

const nonBlank = z.string().refine((s) => s.trim() !== "");

const proof = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("command"), command: nonBlank }),
  z.strictObject({ kind: z.literal("browser"), step: nonBlank }),
]);

const criterion = z.strictObject({
  index: z.number().int(),
  claim: nonBlank,
  proof,
});

export const criteriaSchema = z
  .strictObject({ criteria: z.array(criterion).min(1) })
  .superRefine((value, ctx) => {
    if (value.criteria.some((c, i) => c.index !== i + 1)) {
      ctx.addIssue({
        code: "custom",
        path: ["criteria"],
        params: { code: "invalid_criteria_index" },
        message: "invalid_criteria_index",
      });
    }
  });

export type Criteria = z.infer<typeof criteriaSchema>;
