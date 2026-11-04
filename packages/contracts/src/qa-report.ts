import { z } from "zod";

const nonBlank = (s: string) => s.trim() !== "";

const criterion = z.strictObject({
  index: z.number().int().min(1),
  result: z.enum(["pass", "fail"]),
  how: z.string().optional(),
  screenshots: z.array(z.string()),
});

export const qaReportSchema = z
  .strictObject({
    verdict: z.enum(["pass", "fail"]),
    criteria: z.array(criterion),
    notChecked: z.array(z.string()),
  })
  .superRefine((report, ctx) => {
    const custom = (code: string, path: (string | number)[]) =>
      ctx.addIssue({ code: "custom", path, params: { code }, message: code });
    if (report.verdict === "pass" && report.criteria.length === 0)
      custom("pass_without_criteria", ["criteria"]);
    report.criteria.forEach((c, i) => {
      if (c.how === undefined && report.verdict === "fail") {
        custom("required_field", ["criteria", i, "how"]);
      }
      if (report.verdict !== "pass") return;
      if (c.result === "fail") custom("pass_with_failed_criterion", ["criteria", i, "result"]);
      if (!nonBlank(c.how ?? "")) custom("evidence_missing", ["criteria", i, "how"]);
    });
  })
  .transform((report) => report as RequiredHow<typeof report>);

type RequiredHow<T extends { criteria: Array<{ how?: string | undefined }> }> = Omit<
  T,
  "criteria"
> & { criteria: Array<Omit<T["criteria"][number], "how"> & { how: string }> };

export type QaReport = z.output<typeof qaReportSchema>;
