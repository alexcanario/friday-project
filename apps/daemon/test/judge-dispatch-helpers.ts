import { expect, vi } from "vitest";
import {
  FakeAgentRuntime,
  type AgentRunOptions,
  type IssueRow,
  type JudgeStepOutcome,
} from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import { applyJudgeOutcome, createRunRecorder } from "../src/index.ts";
import type { JudgeDispatchDeps } from "../src/judge-dispatch.ts";
import {
  FakeEvents,
  FakeIssueRepository,
  FakeRunRepository,
  FakeStaleVerdicts,
  slackBudget,
} from "./fakes.ts";

export const A = "a".repeat(40);
export const B = "b".repeat(40);
export const TOKEN = "ghs_marker_token";
export const now = () => new Date("2026-11-05T03:00:00.000Z");

export const row = (state: string, reviewIter = 0): IssueRow => ({
  projectId: "p",
  issueId: 7,
  state,
  heldReason: null,
  verifyRound: 0,
  qaRound: 0,
  reviewIter,
});

export const finished = (
  output: unknown,
  status: RunFinished["status"] = "succeeded",
): RunFinished => ({
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

export const verdict = (over: Record<string, unknown> = {}) => ({
  verdict: "approve",
  headSha: A,
  rules: [1, 2, 3, 4, 5].map((n) => ({ rule: n, answer: "yes", evidence: `ok-${n}` })),
  findings: [],
  risk: "low",
  ...over,
});

export const base = {
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
export const agents = (judge: Record<string, unknown> = {}, strong: Record<string, unknown> = {}) =>
  ({
    judge: { ...base, model: "sonnet", ...judge },
    "judge-strong": { ...base, model: "opus", ...strong },
  }) as unknown as Record<"judge" | "judge-strong", AgentRunOptions>;

export type Options = {
  results?: RunFinished[];
  state?: string;
  reviewIter?: number;
  pr?: number | null;
  env?: Record<string, string | undefined>;
  heads?: string[];
  postFail?: Error;
  agents?: Record<"judge" | "judge-strong", AgentRunOptions>;
};

export function setup(o: Options = {}) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events);
  issues.row = row(o.state ?? "InReview", o.reviewIter ?? 0);
  const runs = new FakeRunRepository();
  const rebuild = issues.rebuild.bind(issues);
  issues.rebuild = (projectId) => {
    rebuild(projectId);
    const last = events.appended.filter((e) => e.type === "StateChanged").at(-1);
    const to = (last?.payload as { to?: string; heldReason?: string | null } | undefined) ?? {};
    if (issues.row && to.to)
      issues.row = { ...issues.row, state: to.to, heldReason: to.heldReason ?? null };
  };
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
    ...slackBudget(recorder),
    now,
    log,
  };
  const types = () => events.appended.map((e) => e.type);
  const ofType = (t: string) => events.appended.filter((e) => e.type === t);
  return { events, issues, runs, runtime, stale, posted, tokens, log, deps, types, ofType };
}

export const ctx = { issueId: 7, runId: "r1" };
export const apply = (t: ReturnType<typeof setup>, outcome: JudgeStepOutcome) =>
  applyJudgeOutcome(t.deps.recorder, ctx, outcome);
export const approved: JudgeStepOutcome = {
  kind: "approved",
  input: { type: "ReviewApproved", headSha: A, prHeadSha: A },
  reviewId: 501,
};
export const changes: JudgeStepOutcome = {
  kind: "changes_requested",
  input: { type: "ChangesRequested" },
  feedback: "1. x",
  reviewId: 501,
};
export const logged = (t: ReturnType<typeof setup>) => t.log.mock.calls.map((c) => c[0]).join("\n");
export const noTokenLeak = (t: ReturnType<typeof setup>) => {
  expect(JSON.stringify(t.events.appended)).not.toContain(TOKEN);
  expect(logged(t)).not.toContain(TOKEN);
};
