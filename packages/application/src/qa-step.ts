import { validateContract, type Criteria, type QaReport, type Violation } from "@friday/contracts";
import type { RunHeldReason } from "@friday/domain";
import type { AgentRuntime, AgentRunRequest } from "./agent-runtime.ts";
import { heldReasonFor } from "./held-reason-for.ts";
import { matchesGlob } from "./glob-match.ts";
import type { WorktreeManager } from "./worktree-manager.ts";

export const QA_ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Bash"] as const;
export const QA_ALLOWED_MCP = ["mcp__friday__qa_report", "mcp__friday__issue_comment"] as const;

export type QaStepInput = {
  request: AgentRunRequest;
  headSha: string;
  criteria: Criteria["criteria"];
  changedFiles: string[];
  screenPaths: string[];
};

export type QaStepDeps = {
  runtime: AgentRuntime;
  worktrees: Pick<WorktreeManager, "isClean">;
};

export type QaFailedCriterion = { index: number; claim: string; how: string };

export type QaStepOutcome =
  | { input: { type: "QaPassed" } }
  | { input: { type: "QaFailed" }; failed: QaFailedCriterion[]; feedback: string }
  | { input: { type: "QaModifiedCode" } }
  | { input: { type: "RunHeld"; reason: RunHeldReason }; violations: Violation[] };

const messages: Record<"required_field" | "invalid_value" | "evidence_missing", string> = {
  required_field: "Campo obrigatório ausente",
  invalid_value: "Valor inválido",
  evidence_missing: "Critério de tela sem screenshot",
};

function violation(code: Violation["code"], path: string): Violation {
  const prefix =
    code === "required_field" || code === "invalid_value" || code === "evidence_missing"
      ? messages[code]
      : "Violação";
  return { code, path, message: `${prefix} (${path}).` };
}

const held = (reason: RunHeldReason, violations: Violation[] = []): QaStepOutcome => ({
  input: { type: "RunHeld", reason },
  violations,
});

const schemaInvalid = (v: Violation): QaStepOutcome => held("SchemaInvalid", [v]);

function misconfigured(agent: AgentRunRequest["agent"]): boolean {
  const tools = new Set<string>(QA_ALLOWED_TOOLS);
  const mcp = new Set<string>(QA_ALLOWED_MCP);
  return agent.tools.some((t) => !tools.has(t)) || agent.allowedTools.some((t) => !mcp.has(t));
}

function coverageProblem(report: QaReport, criteria: Criteria["criteria"]): QaStepOutcome | null {
  if (report.verdict === "pass") {
    const got = report.criteria.map((c) => c.index).sort((a, b) => a - b);
    const want = criteria.map((c) => c.index).sort((a, b) => a - b);
    const exact = got.length === want.length && got.every((n, i) => n === want[i]);
    return exact ? null : schemaInvalid(violation("required_field", "criteria"));
  }
  const known = new Set(criteria.map((c) => c.index));
  const unknown = report.criteria.findIndex((c) => c.result === "fail" && !known.has(c.index));
  if (unknown >= 0) return schemaInvalid(violation("invalid_value", `criteria.${unknown}.index`));
  if (!report.criteria.some((c) => c.result === "fail")) {
    return schemaInvalid(violation("invalid_value", "verdict"));
  }
  return null;
}

function screenshotProblem(report: QaReport, input: QaStepInput): QaStepOutcome | null {
  const touchesScreen = input.changedFiles.some((file) =>
    input.screenPaths.some((glob) => matchesGlob(glob, file)),
  );
  if (!touchesScreen) return null;
  const kinds = new Map(input.criteria.map((c) => [c.index, c.proof.kind]));
  const position = report.criteria.findIndex(
    (c) => kinds.get(c.index) === "browser" && c.screenshots.length === 0,
  );
  if (position < 0) return null;
  return schemaInvalid(violation("evidence_missing", `criteria.${position}.screenshots`));
}

function failure(report: QaReport, criteria: Criteria["criteria"]): QaStepOutcome {
  const claims = new Map(criteria.map((c) => [c.index, c.claim]));
  const failed = report.criteria
    .filter((c) => c.result === "fail")
    .map((c) => ({ index: c.index, claim: claims.get(c.index) ?? "", how: c.how }));
  const feedback = failed
    .map((f) => `Critério ${f.index} reprovado: ${f.claim} — ${f.how}`)
    .join("\n");
  return { input: { type: "QaFailed" }, failed, feedback };
}

export async function runQaStep(deps: QaStepDeps, input: QaStepInput): Promise<QaStepOutcome> {
  const { request, headSha, criteria } = input;
  if (misconfigured(request.agent)) return held("RunMisconfigured");
  const finished = await deps.runtime.run(request);
  if (!(await deps.worktrees.isClean(request.cwd, headSha))) {
    return { input: { type: "QaModifiedCode" } };
  }
  const reason = heldReasonFor(finished);
  if (reason !== null) return held(reason);
  const parsed = validateContract("qaReport", finished.output);
  if (!parsed.ok) return held("SchemaInvalid", parsed.violations);
  const report = parsed.value;
  const problem =
    coverageProblem(report, criteria) ??
    (report.verdict === "pass" ? screenshotProblem(report, input) : null);
  if (problem !== null) return problem;
  return report.verdict === "pass" ? { input: { type: "QaPassed" } } : failure(report, criteria);
}
