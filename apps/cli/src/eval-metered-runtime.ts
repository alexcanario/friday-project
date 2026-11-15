import type { AgentRunRequest, AgentRuntime, RunRecord, RunRepository } from "@friday/application";
import type { RunFinished } from "@friday/contracts";

export type MeteredRuntimeDeps = {
  runtime: AgentRuntime;
  runs: Pick<RunRepository, "save">;
  projectId: string;
  issue: number;
  budgetUsd: number;
  newRunId: () => string;
  now: () => number;
};

export type MeteredTotals = { costUsd: number | null; peakContextTokens: number | null };

export type MeteredRuntime = { runtime: AgentRuntime; totals(): MeteredTotals };

const budgetExceeded = (): RunFinished => ({
  status: "budget_exceeded",
  subtype: null,
  model: null,
  costUsd: 0,
  tokens: null,
  numTurns: null,
  durationMs: null,
  output: null,
  violations: [],
});

function cappedRequest(request: AgentRunRequest, cap: number, runId: string): AgentRunRequest {
  const capped: AgentRunRequest = { ...request, agent: { ...request.agent, maxBudgetUsd: cap } };
  if (request.friday !== undefined) capped.friday = { ...request.friday, runId };
  return capped;
}

/**
 * Wraps a runtime for one pipeline step: each call is capped at `min(card, remaining)` (D113),
 * gets its own `running` row in `runs` (the result tools require it) and adds to the step totals.
 */
export function createMeteredRuntime(deps: MeteredRuntimeDeps): MeteredRuntime {
  let spentUsd = 0;
  let costKnown = true;
  let peak: number | null = null;
  const iso = () => new Date(deps.now()).toISOString();

  function charge(cap: number, finished: RunFinished | null): void {
    const cost = finished?.costUsd ?? null;
    if (cost === null) costKnown = false;
    spentUsd += cost ?? cap;
    const tokens = finished?.peakContextTokens ?? null;
    if (tokens !== null && (peak === null || tokens > peak)) peak = tokens;
  }

  async function run(request: AgentRunRequest): Promise<RunFinished> {
    const cap = Math.min(request.agent.maxBudgetUsd, deps.budgetUsd - spentUsd);
    if (cap <= 0) return budgetExceeded();
    const row: RunRecord = {
      id: deps.newRunId(),
      projectId: deps.projectId,
      issueId: deps.issue,
      phase: null,
      startedAt: iso(),
      finishedAt: null,
      status: "running",
    };
    deps.runs.save(row);
    let finished: RunFinished;
    try {
      finished = await deps.runtime.run(cappedRequest(request, cap, row.id));
    } catch (error) {
      charge(cap, null);
      deps.runs.save({ ...row, finishedAt: iso(), status: "failed" });
      throw error;
    }
    charge(cap, finished);
    const status = finished.status === "succeeded" ? "succeeded" : "failed";
    deps.runs.save({ ...row, finishedAt: iso(), status });
    return finished;
  }

  return {
    runtime: { run },
    totals: () => ({ costUsd: costKnown ? spentUsd : null, peakContextTokens: peak }),
  };
}
