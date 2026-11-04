import { z } from "zod";

export const workReportSchema = z.strictObject({
  summary: z.string().refine((s) => s.trim() !== ""),
  headSha: z.string().refine((s) => /^[0-9a-f]{40}$/.test(s), {
    params: { code: "invalid_head_sha" },
    message: "invalid_head_sha",
  }),
  changedFiles: z.array(z.string()),
  notDone: z.array(z.string()),
});

export type WorkReport = z.infer<typeof workReportSchema>;
