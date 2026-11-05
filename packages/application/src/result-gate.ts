import {
  validateContract,
  type AgentConfig,
  type ContractKind,
  type Violation,
} from "@friday/contracts";
import type { IssueState } from "@friday/domain";

export const RESULT_TOOLS = {
  criteria_set: "criteria",
  work_report: "workReport",
  qa_report: "qaReport",
  review_verdict: "reviewVerdict",
} as const;

export type ResultTool = keyof typeof RESULT_TOOLS;

export interface RunLookup {
  isActive(runId: string): boolean;
}

export interface ResultStore {
  has(runId: string, kind: ContractKind): boolean;
  record(runId: string, kind: ContractKind, value: unknown): void;
}

export type GateRequest = {
  runId: string;
  tool: string;
  agent: Pick<AgentConfig, "states" | "mcp_tools">;
  issueState: IssueState;
  input: unknown;
};

export type GateOutcome =
  | { status: 200; kind: ContractKind; value: unknown }
  | { status: 403 | 404 | 409; message: string }
  | { status: 422; violations: Violation[] };

const isResultTool = (tool: string): tool is ResultTool => Object.hasOwn(RESULT_TOOLS, tool);

/** Gates in fixed order: 403, 404, 409, 422, then 200 (the only one that records). */
export function checkResult(
  deps: { runs: RunLookup; results: ResultStore },
  request: GateRequest,
): GateOutcome {
  const { runId, tool, agent, issueState, input } = request;
  if (
    !isResultTool(tool) ||
    !(agent.mcp_tools as string[]).includes(tool) ||
    !(agent.states as readonly string[]).includes(issueState)
  ) {
    return { status: 403, message: "Ferramenta não permitida para este papel ou estado da issue." };
  }
  if (!deps.runs.isActive(runId)) return { status: 404, message: "A run não está ativa." };
  const kind = RESULT_TOOLS[tool];
  if (deps.results.has(runId, kind)) {
    return { status: 409, message: "Resultado deste tipo já enviado nesta run." };
  }
  const checked = validateContract(kind, input);
  if (!checked.ok) return { status: 422, violations: checked.violations };
  deps.results.record(runId, kind, checked.value);
  return { status: 200, kind, value: checked.value };
}
