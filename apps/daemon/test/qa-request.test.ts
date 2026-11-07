import { describe, expect, it, vi } from "vitest";
import { FakeAgentRuntime, type IssueRow, type StoredEvent } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import * as daemon from "../src/index.ts";
import { createRunRecorder } from "../src/index.ts";
import { runQaForIssue } from "../src/qa-dispatch.ts";
import {
  buildQaStepInput,
  qaTargetOf,
  workReportOf,
  type QaContext,
  type QaRequestInput,
} from "../src/qa-request.ts";
import { FakeEvents, FakeIssueRepository, FakeRunRepository } from "./fakes.ts";

const SHA = "a".repeat(40);
const report = { worktreePath: "/tmp/wt", headSha: SHA, changedFiles: ["src/Version.cs"] };
const criteria = [
  { index: 1, claim: "Retorna 200", proof: { kind: "command" as const, command: "curl localhost/version" } },
  { index: 2, claim: "Mostra a versão", proof: { kind: "browser" as const, step: "abrir /version" } },
];
const agent = {
  model: "sonnet",
  states: ["QA"],
  maxBudgetUsd: 1.5,
  maxTurns: 40,
  timeoutMs: 1800000,
  tools: ["Read", "Glob", "Grep", "Bash"],
  allowedTools: ["mcp__friday__qa_report", "mcp__friday__issue_comment"],
  bashAllow: ["pnpm test"],
  promptFile: "qa.md",
  outputKind: "qaReport",
} as unknown as QaRequestInput["agent"];
const getPullRequest = () => 42;
const context: QaContext = {
  issue: { number: 7, title: "Adiciona GET /version", body: "Corpo" },
  agent,
  friday: {
    runId: "run-1",
    agent: { states: ["QA"], mcp_tools: ["qa_report", "issue_comment"] },
    getIssueState: () => "QA",
  },
  configRoot: "/tmp/cfg",
  branch: "friday/7-version",
  base: "develop",
  getPullRequest,
  screenPaths: ["src/**/*.razor"],
};
const input: QaRequestInput = { ...context, criteria, report };

const ev = (seq: number, type: string, payload: unknown): StoredEvent => ({
  seq,
  projectId: "p",
  issueId: 7,
  runId: null,
  type,
  payload,
  actor: "daemon",
  at: "2026-11-05T03:00:00.000Z",
});
const eventsOf = (list: StoredEvent[]) => ({ list: () => list });

describe("workReportOf", () => {
  it("returns the latest valid WorkReported payload or null", () => {
    expect(workReportOf([ev(1, "WorkReported", report)])).toEqual(report);
    expect(
      workReportOf([
        ev(1, "WorkReported", { ...report, worktreePath: "/tmp/old" }),
        ev(3, "WorkReported", report),
        ev(4, "QaFinished", {}),
      ]),
    ).toEqual(report);
    expect(workReportOf([])).toBeNull();
    expect(workReportOf([ev(1, "StateChanged", {})])).toBeNull();
    for (const bad of [
      { ...report, headSha: "a".repeat(39) },
      { ...report, headSha: "Z".repeat(40) },
      { ...report, worktreePath: "" },
      { ...report, changedFiles: "x" },
      null,
    ]) {
      expect(workReportOf([ev(1, "WorkReported", bad)])).toBeNull();
    }
  });
});

describe("buildQaStepInput", () => {
  it("builds the prompt, the run id and the effects run", () => {
    const out = buildQaStepInput(input);
    expect(out.headSha).toBe(SHA);
    expect(out.criteria).toEqual(criteria);
    expect(out.changedFiles).toEqual(["src/Version.cs"]);
    expect(out.screenPaths).toEqual(["src/**/*.razor"]);
    expect(out.request.cwd).toBe("/tmp/wt");
    expect(out.request.configRoot).toBe("/tmp/cfg");
    expect(out.request.agent).toEqual(agent);
    expect(out.request.friday?.runId).toBe("run-1");
    expect(out.request.friday?.effects?.run).toEqual({
      issue: 7,
      role: "qa",
      branch: "friday/7-version",
      base: "develop",
      worktree: "/tmp/wt",
      getPullRequest,
    });
    expect(out.request.friday?.effects?.run.getPullRequest()).toBe(42);
    const head =
      "Issue #7: Adiciona GET /version\n\nCorpo\n\nCritérios de aceite:\n1. Retorna 200 [command: curl localhost/version]\n2. Mostra a versão [browser: abrir /version]\n\nHead SHA: ";
    expect(out.request.prompt).toBe(`${head}${SHA}\nArquivos mudados: \n- src/Version.cs`);
    const empty = buildQaStepInput({ ...input, report: { ...report, changedFiles: [] } });
    expect(empty.request.prompt.endsWith("\nArquivos mudados: nenhum")).toBe(true);
  });

  it("throws for a branch equal to base, another issue branch or an invalid issue number", () => {
    expect(() => buildQaStepInput({ ...input, branch: "develop" })).toThrow(Error);
    expect(() => buildQaStepInput({ ...input, branch: "friday/8-x" })).toThrow(Error);
    expect(() =>
      buildQaStepInput({ ...input, issue: { ...input.issue, number: 0 } }),
    ).toThrow(Error);
  });
});

describe("qaTargetOf", () => {
  const base = [ev(1, "CriteriaSet", { criteria }), ev(2, "WorkReported", report)];

  it("builds the input from the latest WorkReported and CriteriaSet", () => {
    const ctx = vi.fn<(i: number, r: string) => QaContext | null>(() => context);
    const target = qaTargetOf({ projectId: "p", events: eventsOf(base), context: ctx })(7, "run-1");
    expect(target).toMatchObject({ headSha: SHA, criteria, changedFiles: ["src/Version.cs"] });
    expect(target?.request.cwd).toBe("/tmp/wt");
    expect(target?.request.friday?.runId).toBe("run-1");
    expect(ctx).toHaveBeenCalledTimes(1);
    expect(ctx).toHaveBeenCalledWith(7, "run-1");
    const two = [
      ev(1, "CriteriaSet", { criteria }),
      ev(2, "WorkReported", { ...report, worktreePath: "/tmp/old" }),
      ev(4, "WorkReported", report),
    ];
    const latest = qaTargetOf({ projectId: "p", events: eventsOf(two), context: () => context })(
      7,
      "run-1",
    );
    expect(latest?.request.cwd).toBe("/tmp/wt");
  });

  it("returns null and logs for a missing or invalid input", () => {
    const cases: { events: StoredEvent[]; ctx: QaContext | null; called: boolean }[] = [
      { events: [ev(1, "CriteriaSet", { criteria })], ctx: context, called: false },
      {
        events: [ev(1, "CriteriaSet", { criteria }), ev(2, "WorkReported", { ...report, headSha: "a".repeat(39) })],
        ctx: context,
        called: false,
      },
      { events: [ev(2, "WorkReported", report)], ctx: context, called: false },
      {
        events: [ev(1, "CriteriaSet", { criteria: [] }), ev(2, "WorkReported", report)],
        ctx: context,
        called: false,
      },
      { events: base, ctx: null, called: true },
      { events: base, ctx: { ...context, branch: "develop" }, called: true },
    ];
    for (const c of cases) {
      const log = vi.fn<(m: string) => void>();
      const ctx = vi.fn(() => c.ctx);
      const out = qaTargetOf({ projectId: "p", events: eventsOf(c.events), context: ctx, log })(
        7,
        "run-1",
      );
      expect(out).toBeNull();
      expect(log).toHaveBeenCalled();
      expect(ctx.mock.calls.length > 0).toBe(c.called);
    }
  });
});

const finished = (output: unknown): RunFinished => ({
  status: "succeeded",
  subtype: null,
  model: null,
  costUsd: null,
  tokens: null,
  numTurns: null,
  durationMs: null,
  output,
  violations: [],
});
const pass = {
  verdict: "pass",
  criteria: [
    { index: 1, result: "pass", how: "ok", screenshots: [] },
    { index: 2, result: "pass", how: "ok", screenshots: ["shot.png"] },
  ],
  notChecked: [],
};

function e2e(withReport: boolean) {
  const order: string[] = [];
  const events = new FakeEvents(order);
  const issues = new FakeIssueRepository(events, order, { projectFromEvents: true });
  const row: IssueRow = {
    projectId: "p",
    issueId: 7,
    state: "QA",
    heldReason: null,
    verifyRound: 0,
    qaRound: 0,
    reviewIter: 0,
  };
  issues.rows.set(7, row);
  events.append({ projectId: "p", issueId: 7, runId: null, type: "CriteriaSet", payload: { criteria }, actor: "daemon", at: "2026-11-05T03:00:00.000Z" });
  if (withReport)
    events.append({ projectId: "p", issueId: 7, runId: null, type: "WorkReported", payload: report, actor: "daemon", at: "2026-11-05T03:00:00.000Z" });
  const fake = new FakeAgentRuntime([finished(pass)]);
  const now = () => new Date("2026-11-05T03:00:00.000Z");
  const recorderDeps = { projectId: "p", events, issues, now };
  const deps = {
    projectId: "p",
    targetOf: qaTargetOf({
      projectId: "p",
      events,
      context: (_i, runId) => ({ ...context, friday: { ...context.friday, runId } }),
    }),
    step: { runtime: fake, worktrees: { isClean: async () => true } },
    recorder: recorderDeps,
    recording: {
      runs: new FakeRunRepository(order),
      recorder: createRunRecorder(recorderDeps),
      newRunId: () => "r1",
    },
    now,
  };
  return { deps, fake, issues };
}

describe("runQaForIssue with qaTargetOf", () => {
  it("runs QA end to end from the recorded events", async () => {
    const t = e2e(true);
    await expect(runQaForIssue(t.deps, 7)).resolves.toEqual({ applied: true, feedback: null });
    expect(t.issues.rows.get(7)?.state).toBe("InReview");
    expect(t.fake.requests).toHaveLength(1);
    expect(t.fake.requests[0]?.cwd).toBe("/tmp/wt");
    expect(t.fake.requests[0]?.friday?.runId).toBe("r1");
    const none = e2e(false);
    await expect(runQaForIssue(none.deps, 7)).resolves.toEqual({ applied: false, feedback: null });
    expect(none.fake.requests).toHaveLength(0);
    expect(none.issues.rows.get(7)?.state).toBe("QA");
  });

  it("is exported by the package index", () => {
    expect(daemon.workReportOf).toBe(workReportOf);
    expect(daemon.buildQaStepInput).toBe(buildQaStepInput);
    expect(daemon.qaTargetOf).toBe(qaTargetOf);
  });
});
