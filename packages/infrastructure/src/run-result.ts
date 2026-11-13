import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { validateContract, type RunFinished } from "@friday/contracts";
import type { AgentRunOptions } from "@friday/application";

export type ResultMessage = Extract<SDKMessage, { type: "result" }>;

export interface RunObservation {
  model: string | null;
  initSeen: boolean;
  toolViolation: boolean;
  result: ResultMessage | null;
  timedOut: boolean;
  /** Sha of the last `git_push` of the run; it replaces the agent's `headSha` of a workReport. */
  pushedSha: string | null;
  /** Head of the PR read by the daemon before the run; used as the `headSha` when there was no push (D107). */
  headFallback: string | null;
}

type Tokens = NonNullable<RunFinished["tokens"]>;

const MISSING_OUTPUT = {
  code: "required_field",
  path: "structured_output",
  message: "Campo obrigatório ausente (structured_output).",
};

function sumTokens(result: ResultMessage): Tokens {
  const total: Tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  for (const usage of Object.values(result.modelUsage ?? {})) {
    total.input += usage.inputTokens;
    total.output += usage.outputTokens;
    total.cacheRead += usage.cacheReadInputTokens;
    total.cacheCreation += usage.cacheCreationInputTokens;
  }
  return total;
}

const FAILED_SUBTYPES: Record<string, RunFinished["status"]> = {
  error_max_budget_usd: "budget_exceeded",
  error_max_turns: "turns_exceeded",
  error_max_structured_output_retries: "invalid_output",
};

function statusOf(result: ResultMessage): RunFinished["status"] {
  if (result.subtype !== "success") return FAILED_SUBTYPES[result.subtype] ?? "failed";
  return result.is_error ? "failed" : "succeeded";
}

export function emptyFinished(status: RunFinished["status"], model: string | null): RunFinished {
  return {
    status,
    subtype: null,
    model,
    costUsd: null,
    tokens: null,
    numTurns: null,
    durationMs: null,
    output: null,
    violations: [],
  };
}

export function classify(obs: RunObservation, agent: AgentRunOptions): RunFinished {
  const { result, model } = obs;
  if (result === null) {
    return emptyFinished(
      obs.toolViolation ? "misconfigured" : obs.timedOut ? "timeout" : "failed",
      model,
    );
  }
  const finished: RunFinished = {
    ...emptyFinished(statusOf(result), model),
    subtype: result.subtype,
    costUsd: result.total_cost_usd,
    tokens: sumTokens(result),
    numTurns: result.num_turns,
    durationMs: result.duration_ms,
  };
  if (obs.toolViolation || !obs.initSeen) return { ...finished, status: "misconfigured" };
  if (finished.status === "succeeded" && agent.outputKind != null) {
    return withOutput(finished, result, agent.outputKind, obs.pushedSha ?? obs.headFallback);
  }
  return finished;
}

function withOutput(
  finished: RunFinished,
  result: ResultMessage,
  kind: NonNullable<AgentRunOptions["outputKind"]>,
  knownSha: string | null,
): RunFinished {
  let raw = "structured_output" in result ? result.structured_output : undefined;
  if (kind === "workReport" && knownSha !== null && typeof raw === "object" && raw !== null) {
    raw = { ...raw, headSha: knownSha };
  }
  if (raw === undefined)
    return { ...finished, status: "invalid_output", violations: [MISSING_OUTPUT] };
  const checked = validateContract(kind, raw);
  if (checked.ok) return { ...finished, output: checked.value };
  return { ...finished, status: "invalid_output", violations: checked.violations };
}
