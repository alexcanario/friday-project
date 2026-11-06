import { describe, expect, it, vi } from "vitest";
import {
  FakeAgentRuntime,
  type AgentRunOptions,
  type IssueRow,
  type JudgeStepOutcome,
} from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import { applyJudgeOutcome, createRunRecorder, prHeadReader } from "../src/index.ts";
import { runJudgeForIssue, type JudgeDispatchDeps } from "../src/judge-dispatch.ts";
import {
  FakeEvents,
  FakeIssueRepository,
  FakeRunRepository,
  FakeStaleVerdicts,
} from "./fakes.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const TOKEN = "ghs_marker_token";
const now = () => new Date("2026-11-05T03:00:00.000Z");

const row = (state: string, reviewIter = 0): IssueRow => ({
  projectId: "p",
  issueId: 7,
  state,
  heldReason: null,
  verifyRound: 0,
  qaRound: 0,
  reviewIter,
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

const verdict = (over: Record<string, unknown> = {}) => ({
  verdict: "approve",
  headSha: A,
  rules: [1, 2, 3, 4, 5].map((n) => ({ rule: n, answer: "yes", evidence: `ok-${n}` })),
  findings: [],
  risk: "low",
  ...over,
});

const base = {
  maxBudgetUsd: 1,
  maxTurns: 10,
  timeoutMs: 1000,
  states: ["InReview"],
  bashAllow: [],
  promptFile: "judge.md",
  outputKind: "reviewVerdict",
  tools: ["Read", "Glob", "Grep"],
  allowedTools: ["mcp__friday__review_verdict", "mcp__friday__pr_diff"],
};
const agents = (judge: Record<string, unknown> = {}, strong: Record<string, unknown> = {}) =>
  ({
    judge: { ...base, model: "sonnet", ...judge },
    "judge-strong": { ...base, model: "opus", ...strong },
  }) as unknown as Record<"judge" | "judge-strong", AgentRunOptions>;

type Options = {
  results?: RunFinished[];
  state?: string;
  reviewIter?: number;
  pr?: number | null;
  env?: Record<string, string | undefined>;
  heads?: string[];
  postFail?: Error;
  agents?: Record<"judge" | "judge-strong", AgentRunOptions>;
};

function setup(o: Options = {}) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events);
  issues.row = row(o.state ?? "InReview", o.reviewIter ?? 0);
  const runs = new FakeRunRepository();
  const recorder = { projectId: "p", events, issues, now };
  const runtime = new FakeAgentRuntime(o.results ?? [finished(verdict())]);
  const stale = new FakeStaleVerdicts();
  const posted: Array<{ commitId: string; event: string }> = [];
  const tokens: string[] = [];
  const heads = [...(o.heads ?? [A])];
  const log = vi.fn<(m: string) => void>();
  const deps: JudgeDispatchDeps = {
    projectId: "p",
    prOf: () => (o.pr === undefined ? 30 : o.pr),
    getIssue: () => Promise.resolve({ body: "- risco: low — x", labels: ["friday"] }),
    judgeInput: () => ({ cwd: "/tmp/wt", prompt: "judge", configRoot: "/tmp/cfg" }),
    step: {
      runtime,
      stale,
      env: o.env ?? { FRIDAY_REVIEW_TOKEN: TOKEN },
      reviewTokenEnv: "FRIDAY_REVIEW_TOKEN",
      agents: o.agents ?? agents(),
    },
    readPrHead: () => Promise.resolve(heads.length > 1 ? (heads.shift() as string) : heads[0]!),
    reviewerFor: (token) => {
      tokens.push(token);
      return {
        postReview: (_pr, review) => {
          posted.push(review);
          return o.postFail ? Promise.reject(o.postFail) : Promise.resolve({ id: 501 });
        },
      };
    },
    recorder,
    recording: { runs, recorder: createRunRecorder(recorder), newRunId: () => "r1" },
    now,
    log,
  };
  const types = () => events.appended.map((e) => e.type);
  const ofType = (t: string) => events.appended.filter((e) => e.type === t);
  return { events, issues, runs, runtime, stale, posted, tokens, log, deps, types, ofType };
}

const ctx = { issueId: 7, runId: "r1" };
const apply = (t: ReturnType<typeof setup>, outcome: JudgeStepOutcome) =>
  applyJudgeOutcome(t.deps.recorder, ctx, outcome);
const approved: JudgeStepOutcome = {
  kind: "approved",
  input: { type: "ReviewApproved", headSha: A, prHeadSha: A },
  reviewId: 501,
};
const changes: JudgeStepOutcome = {
  kind: "changes_requested",
  input: { type: "ChangesRequested" },
  feedback: "1. x",
  reviewId: 501,
};
const logged = (t: ReturnType<typeof setup>) => t.log.mock.calls.map((c) => c[0]).join("\n");
const noTokenLeak = (t: ReturnType<typeof setup>) => {
  expect(JSON.stringify(t.events.appended)).not.toContain(TOKEN);
  expect(logged(t)).not.toContain(TOKEN);
};

describe("applyJudgeOutcome", () => {
  it("moves InReview to RiskCheck when the review is approved", () => {
    const t = setup();
    expect(apply(t, approved)).toEqual({ applied: true, feedback: null });
    expect(t.events.appended).toHaveLength(1);
    expect(t.events.appended[0]).toMatchObject({
      type: "StateChanged",
      runId: "r1",
      payload: { from: "InReview", to: "RiskCheck" },
    });
    expect(t.issues.rebuilds).toEqual([{ projectId: "p", appendedCount: 1 }]);
  });

  it("returns the feedback and holds after the third requested change", () => {
    const first = setup();
    expect(apply(first, changes)).toEqual({ applied: true, feedback: "1. x" });
    expect(first.events.appended[0]?.payload).toMatchObject({ to: "InProgress", reviewIter: 1 });
    const third = setup({ reviewIter: 2 });
    expect(apply(third, changes).applied).toBe(true);
    expect(third.events.appended[0]?.payload).toMatchObject({
      to: "Held",
      heldReason: "ReviewItersExhausted",
    });
  });

  it("holds the issue when the review is rejected or the run is held", () => {
    const rejected = setup();
    apply(rejected, { kind: "rejected", input: { type: "ReviewRejected" }, reviewId: 501 });
    expect(rejected.events.appended[0]?.payload).toMatchObject({
      to: "Held",
      heldReason: "ReviewRejected",
    });
    const held = setup();
    apply(held, { kind: "held", input: { type: "RunHeld", reason: "BudgetExceeded" } });
    expect(held.events.appended[0]?.payload).toMatchObject({
      to: "Held",
      heldReason: "BudgetExceeded",
    });
  });

  it("records nothing when the issue is not in review or the outcome has no input", () => {
    const heldIssue = setup({ state: "Held" });
    expect(apply(heldIssue, approved)).toEqual({ applied: false, feedback: null });
    expect(heldIssue.events.appended).toEqual([]);
    expect(heldIssue.issues.rebuilds).toEqual([]);
    const t = setup();
    expect(apply(t, { kind: "stale" })).toEqual({ applied: false, feedback: null });
    expect(apply(t, { kind: "invalid", violations: [] })).toEqual({
      applied: false,
      feedback: null,
    });
    expect(t.events.appended).toEqual([]);
  });
});

describe("runJudgeForIssue", () => {
  it("runs the judge, posts the review and applies the outcome", async () => {
    const t = setup();
    await expect(runJudgeForIssue(t.deps, 7)).resolves.toEqual({ applied: true, feedback: null });
    expect(t.posted).toEqual([expect.objectContaining({ commitId: A, event: "APPROVE" })]);
    expect(t.tokens).toEqual([TOKEN]);
    expect(t.runtime.requests).toHaveLength(1);
    expect(t.ofType("StateChanged")[0]?.payload).toMatchObject({ to: "RiskCheck" });
    expect(t.ofType("JudgeSkipped")).toEqual([]);
    expect(t.ofType("JudgeFinished")).toEqual([]);
    noTokenLeak(t);
  });

  it("records JudgeFinished with the feedback on changes requested", async () => {
    const t = setup({ results: [finished(verdict({ verdict: "request_changes", findings: ["x"] }))] });
    await expect(runJudgeForIssue(t.deps, 7)).resolves.toEqual({ applied: true, feedback: "1. x" });
    expect(t.ofType("StateChanged")[0]?.payload).toMatchObject({ to: "InProgress" });
    expect(t.ofType("JudgeFinished")).toHaveLength(1);
    expect(t.ofType("JudgeFinished")[0]).toMatchObject({
      actor: "daemon",
      runId: "r1",
      payload: { outcome: "changes_requested", feedback: "1. x", reviewId: 501 },
    });
  });

  it("does not run the judge without a pull request", async () => {
    const t = setup({ pr: null });
    await expect(runJudgeForIssue(t.deps, 7)).resolves.toEqual({ applied: false, feedback: null });
    expect(t.runtime.requests).toHaveLength(0);
    expect(t.posted).toHaveLength(0);
    expect(t.events.appended).toEqual([]);
    expect(t.log).toHaveBeenCalledTimes(1);
  });

  it("does not run the judge without the review token", async () => {
    const t = setup({ env: {} });
    await expect(runJudgeForIssue(t.deps, 7)).resolves.toEqual({ applied: false, feedback: null });
    expect(t.runtime.requests).toHaveLength(0);
    expect(t.events.appended).toEqual([]);
    expect(t.log).toHaveBeenCalledTimes(1);
    expect(logged(t)).toContain("FRIDAY_REVIEW_TOKEN");
    noTokenLeak(t);
  });

  it("redacts the review token when postReview fails", async () => {
    const t = setup({ postFail: new Error(`falha com ${TOKEN}`) });
    await expect(runJudgeForIssue(t.deps, 7)).resolves.toEqual({ applied: false, feedback: null });
    expect(t.ofType("StateChanged")).toEqual([]);
    expect(t.ofType("JudgeSkipped")).toEqual([]);
    expect(t.ofType("JudgeFinished")).toEqual([]);
    expect(t.issues.row?.state).toBe("InReview");
    expect(logged(t)).toContain("***");
    noTokenLeak(t);
  });

  it("records JudgeSkipped for an invalid or stale verdict", async () => {
    const invalid = setup({ results: [finished({})] });
    await expect(runJudgeForIssue(invalid.deps, 7)).resolves.toEqual({
      applied: false,
      feedback: null,
    });
    expect(invalid.types()).toEqual(["RunFinished", "JudgeSkipped"]);
    expect(invalid.ofType("JudgeSkipped")[0]).toMatchObject({
      actor: "daemon",
      runId: "r1",
      payload: { reason: "invalid", headSha: A },
    });
    expect(invalid.posted).toHaveLength(0);
    const stale = setup();
    stale.stale.markStale("p", 7, A);
    await runJudgeForIssue(stale.deps, 7);
    expect(stale.ofType("JudgeSkipped")[0]?.payload).toEqual({ reason: "stale", headSha: A });
    expect(stale.posted).toHaveLength(0);
  });

  it("records JudgeSkipped when the pull request head moved", async () => {
    const t = setup({ heads: [A, B] });
    await expect(runJudgeForIssue(t.deps, 7)).resolves.toEqual({ applied: false, feedback: null });
    expect(t.ofType("JudgeSkipped")).toHaveLength(1);
    expect(t.ofType("JudgeSkipped")[0]?.payload).toEqual({ reason: "head_mismatch", headSha: A });
    expect(t.ofType("StateChanged")).toEqual([]);
    expect(t.issues.row?.state).toBe("InReview");
    expect(t.posted).toHaveLength(0);
  });

  it("does not run the judge again for the same head", async () => {
    const same = setup();
    same.events.append({
      projectId: "p",
      issueId: 7,
      runId: "r0",
      type: "JudgeSkipped",
      payload: { reason: "invalid", headSha: A },
      actor: "daemon",
      at: now().toISOString(),
    });
    await expect(runJudgeForIssue(same.deps, 7)).resolves.toEqual({
      applied: false,
      feedback: null,
    });
    expect(same.runtime.requests).toHaveLength(0);
    expect(same.log).toHaveBeenCalledTimes(1);
    const moved = setup({ heads: [B], results: [finished(verdict({ headSha: B }))] });
    moved.events.append({
      projectId: "p",
      issueId: 7,
      runId: "r0",
      type: "JudgeSkipped",
      payload: { reason: "invalid", headSha: A },
      actor: "daemon",
      at: now().toISOString(),
    });
    await runJudgeForIssue(moved.deps, 7);
    expect(moved.runtime.requests).toHaveLength(1);
  });

  it("reads the pull request head from the check status", async () => {
    const getCiStatus = vi.fn(() => Promise.resolve({ headSha: A, state: "success" as const }));
    await expect(prHeadReader({ getCiStatus })(30)).resolves.toBe(A);
    expect(getCiStatus).toHaveBeenCalledExactlyOnceWith(30, "check");
    const failure = new Error("rede");
    const failing = prHeadReader({ getCiStatus: () => Promise.reject(failure) });
    await expect(failing(30)).rejects.toBe(failure);
  });
});

describe("runJudgeForIssue run registration", () => {
  it("records the run row and RunFinished for the judge", async () => {
    const t = setup();
    await runJudgeForIssue(t.deps, 7);
    expect(t.runs.rows.get("r1")).toMatchObject({
      id: "r1",
      status: "succeeded",
      finishedAt: expect.anything(),
    });
    expect(t.runs.rows.size).toBe(1);
    expect(t.ofType("RunFinished")).toHaveLength(1);
    expect(t.ofType("RunFinished")[0]?.runId).toBe("r1");
    expect(t.ofType("StateChanged")[0]?.runId).toBe("r1");
    const medium = setup({
      results: [finished(verdict({ risk: "medium" })), finished(verdict({ risk: "medium" }))],
    });
    await runJudgeForIssue(medium.deps, 7);
    expect(medium.ofType("RunFinished")).toHaveLength(2);
  });

  it("holds as misconfigured when judge-strong has tools outside the allow list", async () => {
    const bad = setup({ agents: agents({ tools: ["Bash"] }) });
    await runJudgeForIssue(bad.deps, 7);
    expect(bad.runtime.requests).toHaveLength(0);
    expect(bad.ofType("RunFinished")).toEqual([]);
    expect(bad.ofType("StateChanged")[0]?.payload).toMatchObject({
      to: "Held",
      heldReason: "RunMisconfigured",
    });
    const strong = setup({
      results: [finished(verdict({ risk: "medium" }))],
      agents: agents({}, { tools: ["Bash"] }),
    });
    await runJudgeForIssue(strong.deps, 7);
    expect(strong.ofType("RunFinished")).toHaveLength(1);
    expect(strong.issues.row?.state).toBe("InReview");
    expect(strong.ofType("StateChanged")).toHaveLength(1);
    expect(strong.ofType("StateChanged")[0]?.payload).toMatchObject({
      to: "Held",
      heldReason: "RunMisconfigured",
    });
  });

  it("closes the run as failed when the step throws or the run is held", async () => {
    const boom = setup({ postFail: new Error("boom") });
    await expect(runJudgeForIssue(boom.deps, 7)).resolves.toEqual({
      applied: false,
      feedback: null,
    });
    expect(boom.runs.rows.get("r1")).toMatchObject({
      status: "failed",
      finishedAt: expect.anything(),
    });
    expect(logged(boom)).toContain("boom");
    const budget = setup({ results: [finished(null, "budget_exceeded")] });
    await runJudgeForIssue(budget.deps, 7);
    expect(budget.runs.rows.get("r1")?.status).toBe("failed");
    expect(budget.ofType("StateChanged")).toHaveLength(1);
    expect(budget.ofType("StateChanged")[0]?.payload).toMatchObject({
      to: "Held",
      heldReason: "BudgetExceeded",
    });
  });
});
