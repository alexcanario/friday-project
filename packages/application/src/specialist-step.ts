import { validateContract, type Violation, type WorkReport } from "@friday/contracts";
import type { RunHeldReason, WorkflowInput, WorkflowSnapshot } from "@friday/domain";
import type { AgentRuntime, AgentRunRequest } from "./agent-runtime.ts";
import { heldReasonFor } from "./held-reason-for.ts";

export const SPECIALIST_ALLOWED_MCP = [
  "mcp__friday__work_report",
  "mcp__friday__git_push",
  "mcp__friday__pr_create",
  "mcp__friday__pr_diff",
  "mcp__friday__issue_comment",
] as const;

export type SpecialistStepInput = {
  request: AgentRunRequest;
  snapshot: Pick<WorkflowSnapshot, "phases" | "phaseIndex">;
};

export type SpecialistStepDeps = { runtime: AgentRuntime };

export type SpecialistStepOutcome =
  | { inputs: WorkflowInput[]; report: WorkReport }
  | { inputs: [{ type: "RunHeld"; reason: RunHeldReason }]; violations: Violation[] };

const held = (reason: RunHeldReason, violations: Violation[] = []): SpecialistStepOutcome => ({
  inputs: [{ type: "RunHeld", reason }],
  violations,
});

function misconfigured(agent: AgentRunRequest["agent"]): boolean {
  const mcp = new Set<string>(SPECIALIST_ALLOWED_MCP);
  return (
    agent.allowedTools.some((t) => !mcp.has(t)) ||
    agent.outputKind !== "workReport" ||
    !agent.states.includes("InProgress")
  );
}

export async function runSpecialistStep(
  deps: SpecialistStepDeps,
  input: SpecialistStepInput,
): Promise<SpecialistStepOutcome> {
  const { request, snapshot } = input;
  if (misconfigured(request.agent)) return held("RunMisconfigured");
  const finished = await deps.runtime.run(request);
  const reason = heldReasonFor(finished);
  if (reason !== null) return held(reason);
  const parsed = validateContract("workReport", finished.output);
  if (!parsed.ok) return held("SchemaInvalid", parsed.violations);
  const remaining = Math.max(0, snapshot.phases.length - snapshot.phaseIndex);
  const inputs: WorkflowInput[] = [
    ...Array.from({ length: remaining }, (): WorkflowInput => ({ type: "PhaseCompleted" })),
    { type: "WorkReported" },
  ];
  return { inputs, report: parsed.value };
}
