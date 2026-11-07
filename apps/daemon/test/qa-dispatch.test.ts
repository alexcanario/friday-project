import { describe, expect, it, vi } from "vitest";
import { FakeAgentRuntime, type IssueRow, type AgentRunRequest } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import * as daemon from "../src/index.ts";
import { createRunRecorder } from "../src/index.ts";
import { runQaForIssue, type QaDispatchDeps } from "../src/qa-dispatch.ts";
import { FakeEvents, FakeIssueRepository, FakeRunRepository, fakeRequest } from "./fakes.ts";

const now = () => new Date("2026-11-05T03:00:00.000Z");
const FINISHED_AT = "2026-11-05T03:00:00.000Z";
const target = () => ({
  request: fakeRequest(7),
  headSha: "a".repeat(40),
  criteria: [
    { index: 1, claim: "botão salva", proof: { kind: "command" as const, command: "pnpm test" } },
  ],
  changedFiles: [],
  screenPaths: [],
});
const finished = (output: unknown, status: RunFinished["status"] = "succeeded"): RunFinished => ({
  status,
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
  criteria: [{ index: 1, result: "pass", how: "ok", screenshots: [] }],
  notChecked: [],
};
const fail = {
  verdict: "fail",
  criteria: [{ index: 1, result: "fail", how: "botão não aparece", screenshots: [] }],
  notChecked: [],
};

type Opts = {
  results?: RunFinished[];
  clean?: boolean;
  noTarget?: boolean;
  runtimeFor?: boolean;
  throws?: boolean;
  qaRound?: number;
};

function setup(o: Opts = {}) {
  const order: string[] = [];
  const events = new FakeEvents(order);
  const issues = new FakeIssueRepository(events, order, { projectFromEvents: true });
  const qaRow: IssueRow = {
    projectId: "p",
    issueId: 7,
    state: "QA",
    heldReason: null,
    verifyRound: 0,
    qaRound: o.qaRound ?? 0,
    reviewIter: 0,
  };
  issues.rows.set(7, qaRow);
  const runs = new FakeRunRepository(order);
  const fake = new FakeAgentRuntime(o.results ?? [finished(pass)]);
  const runtime = {
    run: (r: AgentRunRequest) => {
      order.push("runtime.run");
      return o.throws ? Promise.reject(new Error("boom")) : fake.run(r);
    },
  };
  const recorderDeps = { projectId: "p", events, issues, now };
  const log = vi.fn<(m: string) => void>();
  const other = new FakeAgentRuntime(o.results ?? [finished(pass)]);
  const runtimeFor = vi.fn<NonNullable<QaDispatchDeps["recording"]["runtimeFor"]>>(() => other);
  const deps: QaDispatchDeps = {
    projectId: "p",
    targetOf: () => (o.noTarget ? null : target()),
    step: { runtime, worktrees: { isClean: async () => o.clean ?? true } },
    recorder: recorderDeps,
    recording: {
      runs,
      recorder: createRunRecorder(recorderDeps),
      newRunId: () => "r1",
      ...(o.runtimeFor ? { runtimeFor } : {}),
    },
    now,
    log,
  };
  const types = () => events.appended.map((e) => e.type);
  const state = () => events.appended.filter((e) => e.type === "StateChanged");
  return { order, events, runs, fake, other, runtimeFor, deps, log, types, state };
}

describe("runQaForIssue", () => {
  it("registers the run, records RunFinished and moves to InReview on a passing report", async () => {
    const t = setup();
    await expect(runQaForIssue(t.deps, 7)).resolves.toEqual({ applied: true, feedback: null });
    expect(t.runs.rows.get("r1")).toMatchObject({
      projectId: "p",
      issueId: 7,
      status: "succeeded",
      finishedAt: FINISHED_AT,
    });
    expect(t.types()).toEqual(["RunFinished", "StateChanged"]);
    expect(t.state()[0]).toMatchObject({ runId: "r1", payload: { to: "InReview" } });
    const first = t.order.indexOf("runs.save");
    expect(first).toBeLessThan(t.order.indexOf("runtime.run"));
    expect(first).toBeLessThan(t.order.indexOf("events.append"));
    expect(t.order.filter((x) => x === "runs.save")).toHaveLength(2);
    expect(t.order.at(-1)).toBe("runs.save");
    expect(t.fake.requests).toHaveLength(1);
    expect(t.runtimeFor).not.toHaveBeenCalled();
  });

  it("passes the run id to targetOf and never runs without a target", async () => {
    const t = setup();
    const spy = vi.fn<QaDispatchDeps["targetOf"]>(() => target());
    t.deps.targetOf = spy;
    await runQaForIssue(t.deps, 7);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(7, "r1");
    expect(t.runs.rows.get("r1")?.id).toBe("r1");
    const none = setup({ noTarget: true });
    await expect(runQaForIssue(none.deps, 7)).resolves.toEqual({ applied: false, feedback: null });
    expect(none.fake.requests).toHaveLength(0);
  });

  it("uses runtimeFor when present instead of the step runtime", async () => {
    const t = setup({ runtimeFor: true });
    await runQaForIssue(t.deps, 7);
    expect(t.runtimeFor).toHaveBeenCalledTimes(1);
    expect(t.runtimeFor.mock.calls[0]![0]).toEqual({ runId: "r1", issueId: 7 });
    expect(t.other.requests).toHaveLength(1);
    expect(t.fake.requests).toHaveLength(0);
  });

  it("moves to InProgress and records QaFinished with the feedback on a failing report", async () => {
    const t = setup({ results: [finished(fail)] });
    const text = "Critério 1 reprovado: botão salva — botão não aparece";
    await expect(runQaForIssue(t.deps, 7)).resolves.toEqual({ applied: true, feedback: text });
    expect(t.types()).toEqual(["RunFinished", "StateChanged", "QaFinished"]);
    expect(t.state()[0]).toMatchObject({ payload: { to: "InProgress", qaRound: 1 } });
    expect(t.events.appended[2]).toMatchObject({
      runId: "r1",
      actor: "daemon",
      payload: { outcome: "qa_failed", feedback: text },
    });
    expect(t.runs.rows.get("r1")?.status).toBe("succeeded");
  });

  it("holds with QaRoundsExhausted and records QaFinished on the third failure", async () => {
    const t = setup({ results: [finished(fail)], qaRound: 2 });
    const text = "Critério 1 reprovado: botão salva — botão não aparece";
    await expect(runQaForIssue(t.deps, 7)).resolves.toEqual({ applied: true, feedback: text });
    expect(t.types()).toEqual(["RunFinished", "StateChanged", "QaFinished"]);
    expect(t.state()[0]).toMatchObject({
      payload: { to: "Held", heldReason: "QaRoundsExhausted", qaRound: 3 },
    });
    expect(t.events.appended[2]).toMatchObject({
      runId: "r1",
      actor: "daemon",
      payload: { outcome: "qa_failed", feedback: text },
    });
  });

  it("holds on modified code and records a single StateChanged on budget_exceeded", async () => {
    const a = setup({ clean: false });
    await expect(runQaForIssue(a.deps, 7)).resolves.toEqual({ applied: true, feedback: null });
    expect(a.state()[0]).toMatchObject({
      payload: { to: "Held", heldReason: "QaModifiedCode" },
    });
    expect(a.types()).not.toContain("QaFinished");

    const b = setup({ results: [finished(null, "budget_exceeded")] });
    const result = await runQaForIssue(b.deps, 7);
    expect(result.applied).toBe(false);
    expect(b.types().filter((x) => x === "RunFinished")).toHaveLength(1);
    expect(b.state()).toHaveLength(1);
    expect(b.state()[0]).toMatchObject({ payload: { to: "Held", heldReason: "BudgetExceeded" } });
    expect(b.runs.rows.get("r1")?.status).toBe("failed");
    expect(b.runs.rows.get("r1")?.finishedAt).toBe(FINISHED_AT);
  });

  it("never rejects when there is no target or the runtime throws", async () => {
    const a = setup({ noTarget: true });
    await expect(runQaForIssue(a.deps, 7)).resolves.toEqual({ applied: false, feedback: null });
    expect(a.events.appended).toHaveLength(0);
    expect(a.runs.calls).toBe(0);
    expect(a.fake.requests).toHaveLength(0);
    expect(a.log).toHaveBeenCalledTimes(1);

    const b = setup({ throws: true });
    await expect(runQaForIssue(b.deps, 7)).resolves.toEqual({ applied: false, feedback: null });
    expect(b.runs.rows.get("r1")?.status).toBe("failed");
    expect(b.runs.rows.get("r1")?.finishedAt).toBe(FINISHED_AT);
    expect(b.state()).toHaveLength(0);
    expect(b.log).toHaveBeenCalled();
  });

  it("is exported by the package index", () => {
    expect(typeof daemon.applyQaOutcome).toBe("function");
    expect(typeof daemon.runQaForIssue).toBe("function");
  });
});
