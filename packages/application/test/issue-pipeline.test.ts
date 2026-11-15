import type { WorkflowInput } from "@friday/domain";
import { describe, expect, it } from "vitest";
import {
  experimentRunSchema,
  runIssuePipeline,
  type PipelineStepKind,
  type PipelineStepRequest,
  type PipelineStepResult,
  type PipelineSteps,
  type VariantOutcome,
} from "../src/index.ts";

type Answer = PipelineStepResult | Error;
type Script = Partial<Record<PipelineStepKind, Answer[]>>;

const step = (
  inputs: WorkflowInput[],
  extra: Partial<PipelineStepResult> = {},
): PipelineStepResult => ({
  inputs,
  feedback: null,
  costUsd: 0.1,
  peakContextTokens: 1000,
  ...extra,
});

const SPECIALIST_OK = step([{ type: "PhaseCompleted" }, { type: "WorkReported" }]);
const QA_OK = step([{ type: "QaPassed" }], { peakContextTokens: 2000 });
const JUDGE_OK = step([{ type: "ReviewApproved", headSha: "a", prHeadSha: "a" }], {
  peakContextTokens: 1500,
});
const QA_FAIL = (feedback: string | null = null): PipelineStepResult =>
  step([{ type: "QaFailed" }], { feedback });
const JUDGE_CHANGES = (feedback: string | null = null): PipelineStepResult =>
  step([{ type: "ChangesRequested" }], { feedback });

function fakeSteps(script: Script): PipelineSteps & { calls: PipelineStepRequest[] } {
  const calls: PipelineStepRequest[] = [];
  const used: Record<string, number> = {};
  return {
    calls,
    run(request) {
      calls.push(request);
      const answers = script[request.step] ?? [];
      const index = used[request.step] ?? 0;
      used[request.step] = index + 1;
      const answer = answers[Math.min(index, answers.length - 1)];
      if (answer === undefined) return Promise.reject(new Error(`no answer for ${request.step}`));
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
}

const clock = (...times: number[]) => {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)] ?? 0;
};

const run = (script: Script, maxBudgetUsd = 2) => {
  const steps = fakeSteps(script);
  const outcome = runIssuePipeline({ steps, now: clock(0, 5000) }, { maxBudgetUsd });
  return outcome.then((result) => ({ result, steps }));
};

const kinds = (calls: PipelineStepRequest[]) => calls.map((c) => c.step);

describe("runIssuePipeline", () => {
  it("reaches RiskCheck on a clean pass and measures cost, rounds, time and peak context", async () => {
    const steps = fakeSteps({
      specialist: [SPECIALIST_OK],
      qa: [QA_OK],
      judge: [JUDGE_OK],
    });
    const now = clock(0, 12000, 99999);
    const result = await runIssuePipeline({ steps, now }, { maxBudgetUsd: 2 });
    expect(result.status).toBe("done");
    expect(result.rounds).toBe(2);
    expect(result.judgeFirstRound).toBe(true);
    expect(result.durationS).toBe(12);
    expect(result.peakContextTokens).toBe(2000);
    expect(result.costUsd).toBeCloseTo(0.3);
    expect(kinds(steps.calls)).toEqual(["specialist", "qa", "judge"]);
    expect(steps.calls[0]?.maxBudgetUsd).toBeCloseTo(2);
    expect(steps.calls[1]?.maxBudgetUsd).toBeCloseTo(1.9);
    expect(steps.calls[2]?.maxBudgetUsd).toBeCloseTo(1.8);
    expect(steps.calls[0]).toMatchObject({ round: 1, feedback: null });
  });

  it("sends the QA feedback to the next specialist round", async () => {
    const { result, steps } = await run({
      specialist: [SPECIALIST_OK],
      qa: [QA_FAIL("Critério 1 reprovado"), QA_OK],
      judge: [JUDGE_OK],
    });
    const specialists = steps.calls.filter((c) => c.step === "specialist");
    expect(specialists).toHaveLength(2);
    expect(specialists[1]).toMatchObject({ round: 2, feedback: "Critério 1 reprovado" });
    expect(result).toMatchObject({ status: "done", rounds: 3, judgeFirstRound: true });
  });

  it("goes back through QA after the Judge requests changes and clears judgeFirstRound", async () => {
    const { result, steps } = await run({
      specialist: [SPECIALIST_OK],
      qa: [QA_OK],
      judge: [JUDGE_CHANGES("ajustar"), JUDGE_OK],
    });
    expect(kinds(steps.calls)).toEqual(["specialist", "qa", "judge", "specialist", "qa", "judge"]);
    expect(steps.calls[3]).toMatchObject({ round: 2, feedback: "ajustar" });
    expect(result).toMatchObject({ status: "done", rounds: 4, judgeFirstRound: false });
  });

  it("fails after 3 QA rounds and after a rejected review", async () => {
    const qa = await run({ specialist: [SPECIALIST_OK], qa: [QA_FAIL()], judge: [JUDGE_OK] });
    expect(qa.result).toMatchObject({ status: "failed", rounds: 3, judgeFirstRound: false });
    expect(qa.steps.calls.some((c) => c.step === "judge")).toBe(false);

    const rejected = await run({
      specialist: [SPECIALIST_OK],
      qa: [QA_OK],
      judge: [step([{ type: "ReviewRejected" }])],
    });
    expect(rejected.result).toMatchObject({ status: "failed", rounds: 2, judgeFirstRound: false });
    expect(kinds(rejected.steps.calls)).toEqual(["specialist", "qa", "judge"]);
  });

  it("fails without rejecting on a held run, a throwing step, a refused input or an empty result", async () => {
    const held = await run({
      specialist: [step([{ type: "RunHeld", reason: "SchemaInvalid" }])],
    });
    expect(held.result).toMatchObject({ status: "failed", rounds: 0 });

    const broken: Script[] = [
      { specialist: [new Error("boom")] },
      { specialist: [step([{ type: "QaPassed" }])] },
      { specialist: [step([])] },
    ];
    for (const script of broken) {
      const { result } = await run(script);
      expect(result).toMatchObject({ status: "failed", costUsd: null });
    }
  });

  it("stops when the run cap is spent or the cost is unknown", async () => {
    const spent = await run({ specialist: [step(SPECIALIST_OK.inputs, { costUsd: 2 })] });
    expect(spent.result).toMatchObject({ status: "failed", costUsd: 2 });
    expect(spent.steps.calls.some((c) => c.step === "qa")).toBe(false);

    const unknown = await run({ specialist: [step(SPECIALIST_OK.inputs, { costUsd: null })] });
    expect(unknown.result).toMatchObject({ status: "failed", costUsd: null });
    expect(unknown.steps.calls.some((c) => c.step === "qa")).toBe(false);
  });

  it("produces outcomes that pass experimentRunSchema and handles null cost and peak", async () => {
    const outcomes: VariantOutcome[] = [];
    const scripts: Script[] = [
      { specialist: [SPECIALIST_OK], qa: [QA_OK], judge: [JUDGE_OK] },
      { specialist: [SPECIALIST_OK], qa: [QA_FAIL("x"), QA_OK], judge: [JUDGE_OK] },
      { specialist: [SPECIALIST_OK], qa: [QA_OK], judge: [JUDGE_CHANGES("y"), JUDGE_OK] },
      { specialist: [SPECIALIST_OK], qa: [QA_FAIL()] },
      { specialist: [new Error("boom")] },
      { specialist: [step(SPECIALIST_OK.inputs, { costUsd: 2 })] },
    ];
    for (const script of scripts) outcomes.push((await run(script)).result);
    for (const outcome of outcomes) {
      const parsed = experimentRunSchema.safeParse({
        ...outcome,
        itemId: "E1",
        kind: "backend",
        variant: "generic",
      });
      expect(parsed.success).toBe(true);
    }

    const noPeak = (r: PipelineStepResult) => ({ ...r, peakContextTokens: null });
    const peakless = await run({
      specialist: [noPeak(SPECIALIST_OK)],
      qa: [noPeak(QA_OK)],
      judge: [noPeak(JUDGE_OK)],
    });
    expect(peakless.result.peakContextTokens).toBeNull();

    const unknownJudgeCost = await run({
      specialist: [SPECIALIST_OK],
      qa: [QA_OK],
      judge: [{ ...JUDGE_OK, costUsd: null }],
    });
    expect(unknownJudgeCost.result).toMatchObject({ status: "done", costUsd: null });
  });
});
