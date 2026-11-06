import type { ReviewVerdict } from "@friday/contracts";

export function reviewEventFor(verdict: ReviewVerdict["verdict"]): "APPROVE" | "REQUEST_CHANGES" {
  return verdict === "approve" ? "APPROVE" : "REQUEST_CHANGES";
}

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\r\n|\n/g, " ");

export function renderReviewBody(verdict: ReviewVerdict): string {
  const rows = [...verdict.rules]
    .sort((a, b) => a.rule - b.rule)
    .map((r) => `| ${r.rule} | ${r.answer} | ${cell(r.evidence)} |`);
  return ["| Rule | Answer | Evidence |", "|---|---|---|", ...rows].join("\n");
}
