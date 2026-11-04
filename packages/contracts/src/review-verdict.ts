import { z } from "zod";

const custom = (code: string) => ({ params: { code }, message: code });

const rule = z.strictObject({
  rule: z.number().int(),
  answer: z.enum(["yes", "no"]),
  evidence: z.string().refine((s) => s.trim() !== "", custom("evidence_blank")),
});

const rulesSchema = z
  .array(rule)
  .refine(
    (rules) => rules.length === 5 && [1, 2, 3, 4, 5].every((n) => rules.some((r) => r.rule === n)),
    custom("invalid_rules"),
  );

export const reviewVerdictSchema = z
  .strictObject({
    verdict: z.enum(["approve", "changes_requested", "reject"]),
    headSha: z.string().refine((s) => /^[0-9a-f]{40}$/.test(s), custom("invalid_head_sha")),
    rules: rulesSchema,
    findings: z.array(z.string()),
  })
  .superRefine((review, ctx) => {
    if (review.verdict !== "approve" && review.findings.length === 0) {
      ctx.addIssue({ code: "custom", path: ["findings"], ...custom("findings_missing") });
    }
    if (review.verdict === "approve" && review.rules.some((r) => r.answer === "no")) {
      ctx.addIssue({ code: "custom", path: ["verdict"], ...custom("approve_with_failed_rule") });
    }
  });

export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;
