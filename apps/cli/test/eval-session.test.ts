import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  toAgentRunOptions,
  type AgentRunRequest,
  type RunRecord,
  type WorktreeError,
} from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import type { Result } from "@friday/domain";
import { loadFactoryConfig } from "@friday/infrastructure";
import { createRunSessionFactory, type JudgeStepRunner } from "../src/eval-session.ts";
import { root } from "./helpers.ts";

const loaded = loadFactoryConfig(join(root, "registry"));
if (!loaded.ok) throw new Error("registry inválido");
const generic = toAgentRunOptions(loaded.agents["generic"]!);
const qaCard = toAgentRunOptions(loaded.agents["qa"]!);

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const BRANCH = "friday/12-e1-generic-r1-t1";
const ISSUE = { number: 12, title: "T", body: "B", labels: [] };
const OPEN = { issue: ISSUE, itemId: "E1", variant: "generic", repetition: 1 };
const CRITERIA = [
  { index: 1, claim: "c1", proof: { kind: "command" as const, command: "dotnet test" } },
];
const WORK = { summary: "feito", headSha: SHA_A, changedFiles: ["src/A.cs"], notDone: [] };
const PASS = {
  verdict: "pass",
  criteria: [{ index: 1, result: "pass", how: "ok", screenshots: [] }],
  notChecked: [],
};
const FAIL = {
  verdict: "fail",
  criteria: [{ index: 1, result: "fail", how: "quebrou", screenshots: [] }],
  notChecked: [],
};

const done = (over: Partial<RunFinished> = {}): RunFinished => ({
  status: "succeeded",
  subtype: null,
  model: "sonnet",
  costUsd: 0.1,
  tokens: null,
  numTurns: 1,
  durationMs: 1,
  output: null,
  violations: [],
  ...over,
});

type Handler = (req: AgentRunRequest) => RunFinished;
type Opts = {
  handlers?: Handler[];
  create?: Result<{ path: string }, WorktreeError>;
  remove?: () => Promise<Result<void, WorktreeError>>;
  clean?: boolean;
  judge?: JudgeStepRunner;
};

function setup(opts: Opts = {}) {
  const handlers = [...(opts.handlers ?? [])];
  const requests: AgentRunRequest[] = [];
  const saved: RunRecord[] = [];
  const worktrees = {
    create: vi.fn(async () => opts.create ?? { ok: true as const, value: { path: "/wt/12" } }),
    remove: vi.fn(opts.remove ?? (async () => ({ ok: true as const, value: undefined }))),
    isClean: vi.fn(async () => opts.clean ?? true),
  };
  const judge = vi.fn<JudgeStepRunner>(
    opts.judge ?? (async () => ({ inputs: [{ type: "ChangesRequested" }], feedback: "f" })),
  );
  const readPrHead = vi.fn(async () => SHA_B);
  let n = 0;
  const factory = createRunSessionFactory({
    worktrees,
    worktreesRoot: "/wts",
    project: "sandbox",
    projectId: "p1",
    base: "develop",
    configRoot: "/cfg",
    runTag: "t1",
    runtime: {
      run: async (req) => {
        requests.push(req);
        const next = handlers.shift();
        if (next === undefined) throw new Error("sem handler");
        return next(req);
      },
    },
    runs: { save: (row) => saved.push({ ...row }) },
    agents: { roles: { generic, bad: { ...generic, outputKind: "qaReport" } }, qa: qaCard },
    screenPaths: ["apps/web/**"],
    readPrHead,
    judge,
    newRunId: () => `r${++n}`,
    now: () => 0,
  });
  return { factory, requests, saved, worktrees, judge, readPrHead };
}

const work =
  (over: Partial<RunFinished> = {}): Handler =>
  () =>
    done({ output: WORK, ...over });
const withPr: Handler = (req) => {
  req.friday!.effects!.run.onPrCreated!(77);
  return done({ output: WORK });
};
const specialist = { role: "generic", prompt: "P", maxBudgetUsd: 2 };

async function afterSpecialist(opts: Opts = {}) {
  const s = setup({ ...opts, handlers: [withPr, ...(opts.handlers ?? [])] });
  const session = await s.factory.open(OPEN);
  await session.specialist(specialist);
  return { ...s, session };
}

describe("createRunSessionFactory", () => {
  it("creates one worktree and branch per run and rejects when it cannot", async () => {
    const s = setup({ handlers: [work()] });
    const session = await s.factory.open(OPEN);
    expect(s.worktrees.create).toHaveBeenCalledTimes(1);
    expect(s.worktrees.create).toHaveBeenCalledWith({
      root: "/wts",
      project: "sandbox",
      issue: 12,
      title: "E1-generic-r1-t1",
      base: "develop",
    });
    await session.specialist(specialist);
    expect(s.requests[0]!.friday!.effects!.run.branch).toBe(BRANCH);
    const codes = ["WorktreeExists", "WorktreeCreateFailed", "InvalidPath"] as const;
    for (const code of codes) {
      const message =
        code === "WorktreeExists" ? "A worktree da issue 12 já existe." : `falhou ${code}`;
      const bad = setup({ create: { ok: false, error: { code, message } } });
      await expect(bad.factory.open(OPEN)).rejects.toThrow(`Erro: ${message}`);
      expect(bad.requests).toHaveLength(0);
    }
  });

  it("removes the worktree once on close", async () => {
    const s = setup();
    const session = await s.factory.open(OPEN);
    await session.close();
    await session.close();
    expect(s.worktrees.remove).toHaveBeenCalledTimes(1);
    expect(s.worktrees.remove).toHaveBeenCalledWith({
      root: "/wts",
      project: "sandbox",
      issue: 12,
    });
    const error = { code: "WorktreeRemoveFailed" as const, message: "não removeu" };
    const failing = setup({ remove: async () => ({ ok: false, error }) });
    await expect((await failing.factory.open(OPEN)).close()).resolves.toBeUndefined();
    const throwing = setup({ remove: () => Promise.reject(new Error("caiu")) });
    await expect((await throwing.factory.open(OPEN)).close()).resolves.toBeUndefined();
  });

  it("runs the specialist with the friday fields of its card", async () => {
    const s = setup({ handlers: [work({ costUsd: 0.4, peakContextTokens: 4200 })] });
    const session = await s.factory.open(OPEN);
    const result = await session.specialist(specialist);
    expect(result).toEqual({
      inputs: [{ type: "PhaseCompleted" }, { type: "WorkReported" }],
      feedback: null,
      costUsd: 0.4,
      peakContextTokens: 4200,
      report: WORK,
    });
    expect(generic.maxBudgetUsd).toBe(3);
    const req = s.requests[0]!;
    expect(req.prompt).toBe("P");
    expect(req.cwd).toBe("/wt/12");
    expect(req.configRoot).toBe("/cfg");
    expect(req.agent.maxBudgetUsd).toBe(2);
    expect(req.friday!.agent).toEqual({
      states: ["InProgress"],
      mcp_tools: ["work_report", "git_push", "pr_create", "pr_diff", "issue_comment"],
    });
    expect(req.friday!.getIssueState()).toBe("InProgress");
    expect(req.friday!.effects!.run).toMatchObject({
      issue: 12,
      role: "specialist",
      base: "develop",
      worktree: "/wt/12",
    });
    expect(s.saved[0]!.status).toBe("running");
    expect(req.friday!.runId).toBe(s.saved[0]!.id);
    await expect(session.specialist({ ...specialist, role: "nope" })).rejects.toThrow(
      "Erro: ficha do papel ausente: nope",
    );
  });

  it("caps the specialist budget and maps held outcomes", async () => {
    const held = (reason: string) => [{ type: "RunHeld", reason }];
    const s = setup({
      handlers: [work(), work(), work({ status: "budget_exceeded" }), work({ output: { x: 1 } })],
    });
    const session = await s.factory.open(OPEN);
    await session.specialist({ ...specialist, maxBudgetUsd: 5 });
    expect(s.requests[0]!.agent.maxBudgetUsd).toBe(3);
    await session.specialist({ ...specialist, maxBudgetUsd: 1 });
    expect(s.requests[1]!.agent.maxBudgetUsd).toBe(1);
    const zero = await session.specialist({ ...specialist, maxBudgetUsd: 0 });
    expect(s.requests).toHaveLength(2);
    expect(zero).toMatchObject({ inputs: held("BudgetExceeded"), report: null, costUsd: 0 });
    expect((await session.specialist(specialist)).inputs).toEqual(held("BudgetExceeded"));
    expect((await session.specialist(specialist)).inputs).toEqual(held("SchemaInvalid"));
    const bad = await session.specialist({ ...specialist, role: "bad" });
    expect(bad.inputs).toEqual(held("RunMisconfigured"));
    expect(s.requests).toHaveLength(4);
  });

  it("keeps the PR opened by the specialist for QA and Judge", async () => {
    const before: (number | null)[] = [];
    const opener: Handler = (req) => {
      before.push(req.friday!.effects!.run.getPullRequest());
      return withPr(req);
    };
    const s = setup({ handlers: [opener, () => done({ output: PASS })] });
    const session = await s.factory.open(OPEN);
    await session.specialist(specialist);
    expect(before).toEqual([null]);
    await session.qa({ criteria: CRITERIA, maxBudgetUsd: 1 });
    expect(s.requests[1]!.friday!.effects!.run.getPullRequest()).toBe(77);
    await session.judge({ maxBudgetUsd: 2 });
    expect(s.judge.mock.calls[0]![0].pr).toBe(77);
  });

  it("runs QA on the last report and maps its outcomes", async () => {
    const s = await afterSpecialist({ handlers: [() => done({ output: PASS })] });
    const passed = await s.session.qa({ criteria: CRITERIA, maxBudgetUsd: 1 });
    expect(qaCard.maxBudgetUsd).toBe(1.5);
    const req = s.requests[1]!;
    expect(req.cwd).toBe("/wt/12");
    expect(req.agent.maxBudgetUsd).toBe(1);
    expect(req.friday!.agent).toEqual({
      states: ["QA"],
      mcp_tools: ["qa_report", "issue_comment"],
    });
    expect(req.friday!.getIssueState()).toBe("QA");
    expect(req.friday!.effects!.run.role).toBe("qa");
    expect(req.prompt).toContain(`Head SHA: ${SHA_A}`);
    expect(req.prompt).toContain("1. c1 [command: dotnet test]");
    expect(s.worktrees.isClean).toHaveBeenCalledTimes(1);
    expect(s.worktrees.isClean).toHaveBeenCalledWith("/wt/12", SHA_A);
    expect(passed).toMatchObject({ inputs: [{ type: "QaPassed" }], feedback: null });

    const qa = { criteria: CRITERIA, maxBudgetUsd: 1 };
    const failed = await (
      await afterSpecialist({ handlers: [() => done({ output: FAIL })] })
    ).session.qa(qa);
    expect(failed.inputs).toEqual([{ type: "QaFailed" }]);
    expect(failed.feedback).toContain("Critério 1 reprovado: c1");
    const dirty = await afterSpecialist({ handlers: [() => done({ output: PASS })], clean: false });
    expect((await dirty.session.qa(qa)).inputs).toEqual([{ type: "QaModifiedCode" }]);
    const invalid = await afterSpecialist({ handlers: [() => done({ output: { x: 1 } })] });
    expect((await invalid.session.qa(qa)).inputs).toEqual([
      { type: "RunHeld", reason: "SchemaInvalid" },
    ]);

    const early = await setup().factory.open(OPEN);
    await expect(early.qa(qa)).rejects.toThrow("Erro: QA antes do relatório do especialista");
    const heldRun = setup({ handlers: [work({ status: "failed" })] });
    const heldSession = await heldRun.factory.open(OPEN);
    await heldSession.specialist(specialist);
    await expect(heldSession.qa(qa)).rejects.toThrow("Erro: QA antes do relatório do especialista");
  });

  it("delegates the Judge with the head, the criteria and a metered runtime", async () => {
    const runner: JudgeStepRunner = async (input) => {
      const req = { cwd: input.cwd, prompt: "J", configRoot: "/cfg", agent: generic };
      await input.runtime.run(req);
      await input.runtime.run(req);
      return { inputs: [{ type: "ChangesRequested" }], feedback: "refazer" };
    };
    const s = await afterSpecialist({
      judge: runner,
      handlers: [
        () => done({ output: PASS }),
        () => done({ costUsd: 0.5, peakContextTokens: 5000 }),
        () => done({ costUsd: 1.0, peakContextTokens: 8000 }),
      ],
    });
    await s.session.qa({ criteria: CRITERIA, maxBudgetUsd: 1 });
    const result = await s.session.judge({ maxBudgetUsd: 2 });
    expect(s.readPrHead).toHaveBeenCalledWith(77);
    expect(s.judge).toHaveBeenCalledTimes(1);
    expect(s.judge).toHaveBeenCalledWith({
      issue: ISSUE,
      pr: 77,
      cwd: "/wt/12",
      branch: BRANCH,
      base: "develop",
      expectedHeadSha: SHA_B,
      criteria: CRITERIA,
      runtime: expect.objectContaining({ run: expect.any(Function) }),
      maxBudgetUsd: 2,
    });
    expect(s.requests[3]!.agent.maxBudgetUsd).toBe(1.5);
    expect(result).toEqual({
      inputs: [{ type: "ChangesRequested" }],
      feedback: "refazer",
      costUsd: 1.5,
      peakContextTokens: 8000,
    });

    const noPr = setup({ handlers: [work()] });
    const plain = await noPr.factory.open(OPEN);
    await plain.specialist(specialist);
    await expect(plain.judge({ maxBudgetUsd: 2 })).rejects.toThrow(
      "Erro: Judge antes do PR do especialista",
    );
    const noQa = await afterSpecialist();
    await expect(noQa.session.judge({ maxBudgetUsd: 2 })).rejects.toThrow(
      "Erro: Judge antes do QA",
    );
  });
});
