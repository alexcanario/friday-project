import type { Criteria, WorkReport } from "@friday/contracts";
import type { ContextArea } from "./context-packs.ts";
import type { VariantOutcome, VariantRunRequest, VariantRunner } from "./eval-executor.ts";
import type { IssueSummary } from "./github-port.ts";
import {
  runIssuePipeline,
  type PipelineStepRequest,
  type PipelineStepResult,
  type PipelineSteps,
} from "./issue-pipeline.ts";
import { areasOf, criteriaFor, sandboxIssueOf, specialistPrompt } from "./variant-prompts.ts";

export type SpecialistResult = PipelineStepResult & { report: WorkReport | null };

export interface RunSession {
  specialist(input: {
    role: string;
    prompt: string;
    maxBudgetUsd: number;
  }): Promise<SpecialistResult>;
  qa(input: { criteria: Criteria["criteria"]; maxBudgetUsd: number }): Promise<PipelineStepResult>;
  judge(input: { maxBudgetUsd: number }): Promise<PipelineStepResult>;
  close(): Promise<void>;
}

export interface RunSessionFactory {
  open(input: {
    issue: IssueSummary;
    itemId: string;
    variant: string;
    repetition: number;
  }): Promise<RunSession>;
}

export type SandboxVariantRunnerDeps = {
  issues: { list(): Promise<IssueSummary[]> };
  criteriaById: ReadonlyMap<string, readonly string[]>;
  contextPack: (area: ContextArea) => string | null;
  sessions: RunSessionFactory;
  now: () => number;
};

type Prepared = {
  issue: IssueSummary;
  claims: readonly string[];
  packs: { area: ContextArea; text: string }[];
};

const stepOf = (result: SpecialistResult): PipelineStepResult => ({
  inputs: result.inputs,
  feedback: result.feedback,
  costUsd: result.costUsd,
  peakContextTokens: result.peakContextTokens,
});

const sumCost = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : a + b;

function maxPeak(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  return b === null ? a : Math.max(a, b);
}

async function prepare(
  deps: SandboxVariantRunnerDeps,
  request: VariantRunRequest,
): Promise<Prepared> {
  const { item, variant } = request;
  const issue = sandboxIssueOf(await deps.issues.list(), item.id);
  if (issue === null) throw new Error(`Erro: issue do experimento não encontrada: ${item.id}`);
  const claims = deps.criteriaById.get(item.id);
  if (claims === undefined) throw new Error(`Erro: critérios do experimento ausentes: ${item.id}`);
  const packs: Prepared["packs"] = [];
  if (variant === "generic-context") {
    for (const area of areasOf(item.kind, issue.body)) {
      const text = deps.contextPack(area);
      if (text === null) throw new Error(`Erro: pacote de contexto ausente: ${area}`);
      packs.push({ area, text });
    }
  }
  return { issue, claims, packs };
}

// A later role cannot run when the earlier one is held, cost unknown or the cap is spent:
// the step then returns the earlier result with no inputs, so the pipeline fails the run.
const canContinue = (last: SpecialistResult, remainingUsd: number): boolean =>
  last.costUsd !== null &&
  remainingUsd > 0 &&
  !last.inputs.some((input) => input.type === "RunHeld");

async function runSpecialists(
  session: RunSession,
  prepared: Prepared,
  roles: readonly string[],
  request: PipelineStepRequest,
): Promise<PipelineStepResult> {
  let costUsd: number | null = 0;
  let peak: number | null = null;
  let last: SpecialistResult | null = null;
  let previous: { role: string; result: SpecialistResult } | null = null;
  let remainingUsd = request.maxBudgetUsd;
  for (const role of roles) {
    if (previous !== null && !canContinue(previous.result, remainingUsd)) {
      return { ...stepOf(previous.result), inputs: [] };
    }
    const prompt = specialistPrompt({
      issue: prepared.issue,
      criteria: prepared.claims,
      contextPacks: prepared.packs,
      handoff: previous?.result.report
        ? { role: previous.role, report: previous.result.report }
        : null,
      feedback: request.feedback,
    });
    const result = await session.specialist({ role, prompt, maxBudgetUsd: remainingUsd });
    costUsd = sumCost(costUsd, result.costUsd);
    peak = maxPeak(peak, result.peakContextTokens);
    last = result;
    remainingUsd -= result.costUsd ?? 0;
    previous = { role, result };
  }
  if (last === null) throw new Error("Erro: nenhum papel para rodar");
  return { ...stepOf(last), costUsd, peakContextTokens: peak };
}

function stepsFor(
  session: RunSession,
  prepared: Prepared,
  roles: readonly string[],
): PipelineSteps {
  const criteria = criteriaFor(prepared.claims);
  return {
    run(request) {
      if (request.step === "specialist") return runSpecialists(session, prepared, roles, request);
      if (request.step === "qa")
        return session.qa({ criteria, maxBudgetUsd: request.maxBudgetUsd });
      return session.judge({ maxBudgetUsd: request.maxBudgetUsd });
    },
  };
}

export function createSandboxVariantRunner(deps: SandboxVariantRunnerDeps): VariantRunner {
  return {
    async run(request): Promise<VariantOutcome> {
      const prepared = await prepare(deps, request);
      const session = await deps.sessions.open({
        issue: prepared.issue,
        itemId: request.item.id,
        variant: request.variant,
        repetition: request.repetition,
      });
      try {
        return await runIssuePipeline(
          { steps: stepsFor(session, prepared, request.roles), now: deps.now },
          { maxBudgetUsd: request.maxBudgetUsd },
        );
      } finally {
        await session.close().catch(() => undefined);
      }
    },
  };
}
