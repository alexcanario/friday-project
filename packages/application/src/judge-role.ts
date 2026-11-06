export type DeclaredRisk = "low" | "medium" | "high";

export const JUDGE_ALLOWED_TOOLS = ["Read", "Glob", "Grep"] as const;
export const JUDGE_ALLOWED_MCP = ["mcp__friday__review_verdict", "mcp__friday__pr_diff"] as const;

export function parseDeclaredRisk(body: string): DeclaredRisk | null {
  const match = /^- risco: (low|medium|high)\b/m.exec(body);
  return match === null ? null : (match[1] as DeclaredRisk);
}

export function chooseJudgeRole(input: {
  declaredRisk: DeclaredRisk | null;
  labels: string[];
}): "judge" | "judge-strong" {
  const gated = input.labels.some((label) => label.startsWith("gate:"));
  return input.declaredRisk === "low" && !gated ? "judge" : "judge-strong";
}
