import { triageSchema, validateContract, type Triage } from "@friday/contracts";
import type { RunHeldReason, WorkflowInput } from "@friday/domain";
import type { AgentRuntime, AgentRunRequest } from "./agent-runtime.ts";
import type { GitHubPort, IssueSummary } from "./github-port.ts";
import { heldReasonFor } from "./held-reason-for.ts";

export const SPECIALIST_LABEL_PREFIX = "specialist:";

export type TriageStepDeps = {
  runtime: AgentRuntime;
  github: Pick<GitHubPort, "addLabel" | "postAgentComment">;
};

export type TriageStepInput = {
  issue: IssueSummary;
  state: "Todo" | "Triage";
  request: AgentRunRequest;
  flow: { model: string; maxBudgetUsd: number };
};

export type TriageStepOutcome = {
  inputs: WorkflowInput[];
  specialist: Triage["specialist"] | null;
};

function existingSpecialist(labels: string[]): Triage["specialist"] | null {
  const valid: readonly string[] = triageSchema.shape.specialist.options;
  for (const label of labels) {
    if (!label.startsWith(SPECIALIST_LABEL_PREFIX)) continue;
    const value = label.slice(SPECIALIST_LABEL_PREFIX.length);
    if (valid.includes(value)) return value as Triage["specialist"];
  }
  return null;
}

function misconfigured(request: AgentRunRequest, flow: TriageStepInput["flow"]): boolean {
  const { agent } = request;
  return (
    agent.model !== flow.model ||
    agent.maxBudgetUsd !== flow.maxBudgetUsd ||
    agent.outputKind !== "triage" ||
    agent.tools.length > 0 ||
    agent.allowedTools.length > 0
  );
}

const outcome = (
  state: TriageStepInput["state"],
  rest: WorkflowInput[],
  specialist: Triage["specialist"] | null = null,
): TriageStepOutcome => ({
  inputs: state === "Todo" ? [{ type: "NeedsTriage" }, ...rest] : rest,
  specialist,
});

const held = (state: TriageStepInput["state"], reason: RunHeldReason): TriageStepOutcome =>
  outcome(state, [{ type: "RunHeld", reason }]);

export async function runTriageStep(
  deps: TriageStepDeps,
  input: TriageStepInput,
): Promise<TriageStepOutcome> {
  const { issue, state, request, flow } = input;
  if (state !== "Todo" && state !== "Triage") throw new Error(`Estado sem triagem: ${state}`);
  const existing = existingSpecialist(issue.labels);
  if (existing !== null) return { inputs: [{ type: "SpecialistAssigned" }], specialist: existing };
  if (misconfigured(request, flow)) return held(state, "RunMisconfigured");
  const finished = await deps.runtime.run(request);
  const reason = heldReasonFor(finished);
  if (reason !== null && finished.status !== "invalid_output") return held(state, reason);
  const parsed =
    finished.status === "invalid_output" ? null : validateContract("triage", finished.output);
  if (parsed === null || !parsed.ok) return outcome(state, [{ type: "TriageFailed" }]);
  const { specialist, reason: why } = parsed.value;
  await deps.github.addLabel(issue.number, `${SPECIALIST_LABEL_PREFIX}${specialist}`);
  await deps.github.postAgentComment(
    issue.number,
    "triage",
    `Triagem: ${specialist}. Motivo: "${why}"`,
  );
  return outcome(state, [{ type: "SpecialistAssigned" }], specialist);
}
