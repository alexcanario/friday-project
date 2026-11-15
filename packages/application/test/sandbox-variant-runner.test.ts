import type { WorkReport } from "@friday/contracts";
import type { WorkflowInput } from "@friday/domain";
import { describe, expect, it } from "vitest";
import {
  createSandboxVariantRunner,
  criteriaFor,
  experimentRunSchema,
  type ContextArea,
  type IssueSummary,
  type PipelineStepResult,
  type RunSession,
  type RunSessionFactory,
  type VariantRunRequest,
} from "../src/index.ts";

type SpecialistInput = Parameters<RunSession["specialist"]>[0];
type SpecialistResult = PipelineStepResult & { report: WorkReport | null };

const reportOf = (summary: string): WorkReport => ({
  summary,
  headSha: "b".repeat(40),
  changedFiles: [`${summary}.cs`],
  notDone: [],
});

const result = (
  inputs: WorkflowInput[],
  extra: Partial<PipelineStepResult> = {},
): PipelineStepResult => ({
  inputs,
  feedback: null,
  costUsd: 0.1,
  peakContextTokens: 1000,
  ...extra,
});

const specialistOk = (
  summary: string,
  extra: Partial<PipelineStepResult> = {},
): SpecialistResult => ({
  ...result([{ type: "PhaseCompleted" }, { type: "WorkReported" }], extra),
  report: reportOf(summary),
});
const QA_OK = result([{ type: "QaPassed" }]);
const JUDGE_OK = result([{ type: "ReviewApproved", headSha: "a", prHeadSha: "a" }]);

type Script = {
  specialist?: (SpecialistResult | Error)[];
  qa?: (PipelineStepResult | Error)[];
  judge?: (PipelineStepResult | Error)[];
};

function fakeFactory(script: Script) {
  const log = {
    opened: [] as Parameters<RunSessionFactory["open"]>[0][],
    specialist: [] as SpecialistInput[],
    qa: [] as Parameters<RunSession["qa"]>[0][],
    judge: [] as Parameters<RunSession["judge"]>[0][],
    closed: 0,
  };
  const used = { specialist: 0, qa: 0, judge: 0 };
  const next = <T>(kind: keyof typeof used, answers: (T | Error)[] | undefined): Promise<T> => {
    const list = answers ?? [];
    const answer = list[Math.min(used[kind]++, list.length - 1)];
    if (answer === undefined) return Promise.reject(new Error(`no answer for ${kind}`));
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  const sessions: RunSessionFactory = {
    open(input) {
      log.opened.push(input);
      return Promise.resolve({
        specialist: (i) => (log.specialist.push(i), next("specialist", script.specialist)),
        qa: (i) => (log.qa.push(i), next("qa", script.qa)),
        judge: (i) => (log.judge.push(i), next("judge", script.judge)),
        close: () => ((log.closed += 1), Promise.resolve()),
      });
    },
  };
  return { sessions, log };
}

const E1: IssueSummary = { number: 11, title: "E1: GET /health", body: "Corpo E1", labels: [] };
const CLAIMS = ["Responde 200", "Corpo ok"];

function build(
  script: Script,
  overrides: { issues?: IssueSummary[]; claims?: boolean; missingPack?: ContextArea } = {},
) {
  const { sessions, log } = fakeFactory(script);
  const asked: ContextArea[] = [];
  const runner = createSandboxVariantRunner({
    issues: { list: () => Promise.resolve(overrides.issues ?? [E1]) },
    criteriaById: new Map(overrides.claims === false ? [] : [["E1", CLAIMS]]),
    contextPack: (area) => {
      asked.push(area);
      return area === overrides.missingPack ? null : `PACOTE-${area}`;
    },
    sessions,
    now: (() => {
      let t = 0;
      return () => (t += 4000);
    })(),
  });
  return { runner, log, asked };
}

const request = (over: Partial<VariantRunRequest> = {}): VariantRunRequest => ({
  item: { id: "E1", kind: "backend" },
  variant: "generic",
  repetition: 1,
  roles: ["generic"],
  maxBudgetUsd: 2,
  ...over,
});

const OK: Script = { specialist: [specialistOk("backend")], qa: [QA_OK], judge: [JUDGE_OK] };

describe("createSandboxVariantRunner", () => {
  it("runs one issue for the generic variant", async () => {
    const { runner, log } = build(OK);
    const outcome = await runner.run(request());
    expect(log.opened).toEqual([{ issue: E1, itemId: "E1", variant: "generic", repetition: 1 }]);
    expect(log.specialist).toHaveLength(1);
    expect(log.specialist[0]?.role).toBe("generic");
    expect(log.specialist[0]?.prompt).not.toContain("## Pacote de contexto");
    expect(log.qa).toEqual([{ criteria: criteriaFor(CLAIMS), maxBudgetUsd: expect.any(Number) }]);
    expect(log.closed).toBe(1);
    const parsed = experimentRunSchema.safeParse({
      ...outcome,
      itemId: "E1",
      kind: "backend",
      variant: "generic",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.status).toBe("done");
  });

  it("injects the context packs only in generic-context and rejects a missing pack", async () => {
    const cross = { item: { id: "E1", kind: "cross" as const } };
    const withPacks = build(OK);
    await withPacks.runner.run(request({ ...cross, variant: "generic-context" }));
    const prompt = withPacks.log.specialist[0]?.prompt ?? "";
    expect(prompt).toContain("## Pacote de contexto: backend");
    expect(prompt).toContain("## Pacote de contexto: frontend");

    const plain = build(OK);
    await plain.runner.run(request({ ...cross, variant: "generic" }));
    expect(plain.log.specialist[0]?.prompt).not.toContain("## Pacote de contexto");
    expect(plain.asked).toEqual([]);

    const absent = build(OK, { missingPack: "frontend" });
    await expect(
      absent.runner.run(request({ ...cross, variant: "generic-context" })),
    ).rejects.toThrow("Erro: pacote de contexto ausente: frontend");
    expect(absent.log.opened).toHaveLength(0);
  });

  it("hands the backend report to the frontend in cross issues", async () => {
    const cross = request({
      item: { id: "E1", kind: "cross" },
      variant: "specialists",
      roles: ["backend", "frontend"],
    });
    const ok = build({
      specialist: [specialistOk("backend", { costUsd: 0.5 }), specialistOk("frontend")],
      qa: [QA_OK],
      judge: [JUDGE_OK],
    });
    const outcome = await ok.runner.run(cross);
    expect(ok.log.specialist.map((s) => s.role)).toEqual(["backend", "frontend"]);
    expect(ok.log.specialist[1]?.prompt).toContain("## Relatório do backend");
    expect(ok.log.specialist[1]?.prompt).toContain("backend");
    expect(ok.log.specialist[0]?.maxBudgetUsd).toBeCloseTo(2);
    expect(ok.log.specialist[1]?.maxBudgetUsd).toBeCloseTo(1.5);
    expect(ok.log.qa).toHaveLength(1);
    expect(ok.log.judge).toHaveLength(1);
    expect(outcome.status).toBe("done");
    expect(outcome.costUsd).toBeCloseTo(0.5 + 0.1 + 0.1 + 0.1);

    const held = build({
      specialist: [{ ...result([{ type: "RunHeld", reason: "BudgetExceeded" }]), report: null }],
    });
    expect((await held.runner.run(cross)).status).toBe("failed");
    expect(held.log.specialist).toHaveLength(1);

    const unknown = build({
      specialist: [specialistOk("backend", { costUsd: null })],
      qa: [QA_OK],
    });
    expect((await unknown.runner.run(cross)).status).toBe("failed");
    expect(unknown.log.specialist).toHaveLength(1);

    const spent = build({ specialist: [specialistOk("backend", { costUsd: 2 })], qa: [QA_OK] });
    expect((await spent.runner.run(cross)).status).toBe("failed");
    expect(spent.log.specialist).toHaveLength(1);
  });

  it("reruns every role with the feedback", async () => {
    const { runner, log } = build({
      specialist: [specialistOk("backend"), specialistOk("frontend")],
      qa: [result([{ type: "QaFailed" }], { feedback: "ajustar" }), QA_OK],
      judge: [JUDGE_OK],
    });
    const outcome = await runner.run(
      request({
        item: { id: "E1", kind: "cross" },
        variant: "specialists",
        roles: ["backend", "frontend"],
      }),
    );
    expect(outcome.status).toBe("done");
    expect(log.specialist.map((s) => s.role)).toEqual([
      "backend",
      "frontend",
      "backend",
      "frontend",
    ]);
    expect(log.specialist[0]?.prompt).not.toContain("Feedback da rodada anterior:");
    expect(log.specialist[2]?.prompt).toContain("Feedback da rodada anterior:\najustar");
    expect(log.specialist[3]?.prompt).toContain("Feedback da rodada anterior:\najustar");
  });

  it("rejects unknown issues and criteria and always closes the session", async () => {
    const noIssue = build(OK, { issues: [] });
    await expect(noIssue.runner.run(request())).rejects.toThrow(
      "Erro: issue do experimento não encontrada: E1",
    );
    expect(noIssue.log.opened).toHaveLength(0);

    const noCriteria = build(OK, { claims: false });
    await expect(noCriteria.runner.run(request())).rejects.toThrow(
      "Erro: critérios do experimento ausentes: E1",
    );
    expect(noCriteria.log.opened).toHaveLength(0);

    const broken = build({ specialist: [new Error("boom")] });
    const outcome = await broken.runner.run(request());
    expect(outcome.status).toBe("failed");
    expect(broken.log.closed).toBe(1);
  });
});
