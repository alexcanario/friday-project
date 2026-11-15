import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  renderReviewBody,
  toAgentRunOptions,
  type AgentRunRequest,
  type GitHubPort,
  type ReviewCredential,
} from "@friday/application";
import type { ReviewVerdict, RunFinished } from "@friday/contracts";
import { loadFactoryConfig } from "@friday/infrastructure";
import { createJudgeStepRunner, escapeControl, judgePromptOf } from "../src/eval-session-judge.ts";
import { root } from "./helpers.ts";

const loaded = loadFactoryConfig(join(root, "registry"));
if (!loaded.ok) throw new Error("registry inválido");
const judgeCard = toAgentRunOptions(loaded.agents["judge"]!);
const strongCard = toAgentRunOptions(loaded.agents["judge-strong"]!);

const H1 = "a".repeat(40);
const H2 = "b".repeat(40);
const BRANCH = "friday/12-e1-generic-r1-t1";
const ISSUE = { number: 12, title: "T", body: "B", labels: [] };
const CRITERIA = [
  { index: 1, claim: "c1", proof: { kind: "command" as const, command: "dotnet test" } },
];
const ENV_REVIEW: ReviewCredential = { mode: "env", tokenEnv: "REVIEW_TOKEN" };

const RULES = [1, 2, 3, 4, 5].map((rule) => ({ rule, answer: "yes" as const, evidence: "ok" }));
function verdict(over: Partial<ReviewVerdict> = {}): ReviewVerdict {
  return { verdict: "approve", headSha: H1, rules: RULES, findings: [], risk: "low", ...over };
}

const done = (over: Partial<RunFinished> = {}): RunFinished => ({
  status: "succeeded",
  subtype: null,
  model: "opus",
  costUsd: 0.1,
  tokens: null,
  numTurns: 1,
  durationMs: 1,
  output: null,
  violations: [],
  ...over,
});
const finished = (v: ReviewVerdict) => done({ output: v });

type Opts = {
  results?: RunFinished[];
  prHead?: string;
  env?: Record<string, string | undefined>;
  review?: ReviewCredential;
  staleAlready?: boolean;
};

function fakeStale(staleAlready: boolean) {
  const stale = new Set<string>();
  const key = (p: string, i: number, h: string) => `${p}|${i}|${h}`;
  return {
    markStale: vi.fn((p: string, i: number, h: string) => void stale.add(key(p, i, h))),
    isStale: vi.fn((p: string, i: number, h: string) => staleAlready || stale.has(key(p, i, h))),
  };
}

function fakeRuntime(queued: RunFinished[], requests: AgentRunRequest[]) {
  const results = [...queued];
  return {
    run: async (req: AgentRunRequest) => {
      requests.push(req);
      const next = results.shift();
      if (next === undefined) throw new Error("sem resultado");
      return next;
    },
  };
}

function setup(opts: Opts = {}) {
  const requests: AgentRunRequest[] = [];
  const staleVerdicts = fakeStale(opts.staleAlready === true);
  const postReview = vi.fn<GitHubPort["postReview"]>(async () => ({ id: 9 }));
  const reviewer = vi.fn<(token: string) => { postReview: typeof postReview }>(() => ({
    postReview,
  }));
  const readPrHead = vi.fn(async () => opts.prHead ?? H1);
  const runner = createJudgeStepRunner({
    projectId: "p1",
    configRoot: "/cfg",
    stale: staleVerdicts,
    readPrHead,
    reviewer,
    env: opts.env ?? { REVIEW_TOKEN: "tok" },
    review: opts.review ?? ENV_REVIEW,
    agents: { judge: judgeCard, "judge-strong": strongCard },
  });
  const runtime = fakeRuntime(opts.results ?? [], requests);
  const input = (over: { body?: string; expectedHeadSha?: string } = {}) => ({
    issue: { ...ISSUE, body: over.body ?? ISSUE.body },
    pr: 77,
    cwd: "/wt/12",
    branch: BRANCH,
    base: "develop",
    expectedHeadSha: over.expectedHeadSha ?? H1,
    criteria: CRITERIA,
    runtime,
    maxBudgetUsd: 2,
  });
  const run = (over: { body?: string; expectedHeadSha?: string } = {}) => runner(input(over));
  return { run, requests, postReview, reviewer, readPrHead, staleVerdicts };
}

describe("judgePromptOf", () => {
  it("builds the Judge prompt with the head and the criteria", () => {
    const prompt = judgePromptOf({ issue: ISSUE, headSha: H1, criteria: CRITERIA });
    expect(prompt).toBe(
      `Review the pull request of issue #12. The head SHA of the pull request is ${H1}. Read the diff with pr_diff and finish by calling review_verdict once, with that value in headSha.\n\nCritérios de aceite:\n1. c1 [command: dotnet test]`,
    );
  });

  it("escapes the control characters of the criteria and leaves other text unchanged", () => {
    const claim = "a\nb\r\tc\u001bd\u0005e\u2028f\u007fg";
    const prompt = judgePromptOf({
      issue: ISSUE,
      headSha: H1,
      criteria: [{ index: 1, claim, proof: { kind: "command" as const, command: "x\ny" } }],
    });
    const lines = prompt.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines.at(-1)).toBe(String.raw`1. a\nb\r\tc\u001bd\u0005e\u2028f\u007fg [command: x\ny]`);
    const bidi = judgePromptOf({
      issue: ISSUE,
      headSha: H1,
      criteria: [{ index: 1, claim: "a\u202eb", proof: { kind: "browser" as const, step: "s" } }],
    });
    expect(bidi.split("\n").at(-1)).toBe(String.raw`1. a\u202eb [browser: s]`);
    expect(escapeControl("plano ção ✓ \\")).toBe("plano ção ✓ \\");
  });
});

describe("createJudgeStepRunner", () => {
  it("approves with the friday fields of the Judge and posts the review", async () => {
    const v = verdict();
    const s = setup({ results: [finished(v)] });
    const result = await s.run();
    expect(result).toEqual({
      inputs: [{ type: "ReviewApproved", headSha: H1, prHeadSha: H1 }],
      feedback: null,
    });
    expect(s.reviewer.mock.calls).toEqual([["tok"]]);
    expect(s.postReview.mock.calls).toEqual([
      [77, { commitId: H1, event: "APPROVE", body: renderReviewBody(v) }],
    ]);
    expect(s.requests).toHaveLength(1);
    const req = s.requests[0]!;
    expect(req.agent).toEqual(strongCard);
    expect(req.cwd).toBe("/wt/12");
    expect(req.configRoot).toBe("/cfg");
    expect(req.prompt).toBe(judgePromptOf({ issue: ISSUE, headSha: H1, criteria: CRITERIA }));
    const friday = req.friday!;
    expect(friday.runId).toBe("unassigned");
    expect(friday.agent).toEqual({
      states: ["InReview"],
      mcp_tools: ["review_verdict", "pr_diff"],
    });
    expect(friday.getIssueState()).toBe("InReview");
    const effects = friday.effects!.run;
    expect(effects).toMatchObject({
      issue: 12,
      role: "judge",
      branch: BRANCH,
      base: "develop",
      worktree: "/wt/12",
    });
    expect(effects.getPullRequest()).toBe(77);
  });

  it("repeats with judge-strong when a low-risk verdict is not low", async () => {
    const low = "B\n- risco: low\n";
    const once = setup({ results: [finished(verdict())] });
    await once.run({ body: low });
    expect(once.requests.map((r) => r.agent)).toEqual([judgeCard]);
    const s = setup({ results: [finished(verdict({ risk: "medium" })), finished(verdict())] });
    const result = await s.run({ body: low });
    expect(s.requests).toHaveLength(2);
    expect(s.requests[0]!.agent).toEqual(judgeCard);
    const repeat = s.requests[1]!.agent;
    expect(repeat.model).toBe(strongCard.model);
    expect(repeat.maxBudgetUsd).toBe(strongCard.maxBudgetUsd);
    expect(repeat.allowedTools).toEqual(
      strongCard.allowedTools.filter((t) => t !== "mcp__friday__review_verdict"),
    );
    expect(result.inputs).toEqual([{ type: "ReviewApproved", headSha: H1, prHeadSha: H1 }]);
  });

  it("maps changes_requested and reject", async () => {
    const changes = verdict({ verdict: "changes_requested", findings: ["f1"] });
    const c = setup({ results: [finished(changes)] });
    expect(await c.run()).toEqual({ inputs: [{ type: "ChangesRequested" }], feedback: "1. f1" });
    expect(c.postReview).toHaveBeenCalledTimes(1);
    expect(c.postReview.mock.calls[0]![1]).toMatchObject({ event: "REQUEST_CHANGES" });
    const r = setup({ results: [finished(verdict({ verdict: "reject", findings: ["f2"] }))] });
    expect(await r.run()).toEqual({ inputs: [{ type: "ReviewRejected" }], feedback: null });
    expect(r.postReview).toHaveBeenCalledTimes(1);
  });

  it("holds the run for an invalid or failed Judge run", async () => {
    const cases: [RunFinished, string][] = [
      [done({ output: { verdict: "approve" } }), "SchemaInvalid"],
      [done({ status: "invalid_output", violations: [] }), "SchemaInvalid"],
      [done({ status: "failed" }), "RuntimeFailed"],
      [done({ status: "budget_exceeded" }), "BudgetExceeded"],
      [done({ status: "misconfigured" }), "RunMisconfigured"],
    ];
    for (const [result, reason] of cases) {
      const s = setup({ results: [result] });
      expect(await s.run()).toEqual({ inputs: [{ type: "RunHeld", reason }], feedback: null });
      expect(s.postReview).not.toHaveBeenCalled();
    }
  });

  it("refuses a verdict for another head and a stale verdict", async () => {
    const moved = setup({ results: [finished(verdict())], prHead: H2 });
    expect(await moved.run()).toEqual({
      inputs: [{ type: "ReviewApproved", headSha: H1, prHeadSha: H2 }],
      feedback: null,
    });
    expect(moved.postReview).not.toHaveBeenCalled();
    expect(moved.staleVerdicts.isStale("p1", 12, H1)).toBe(true);

    const other = setup({ results: [finished(verdict())], prHead: H2 });
    expect(await other.run({ expectedHeadSha: H2 })).toEqual({
      inputs: [{ type: "ReviewApproved", headSha: H1, prHeadSha: H2 }],
      feedback: null,
    });
    expect(other.postReview).not.toHaveBeenCalled();
    expect(other.staleVerdicts.markStale).not.toHaveBeenCalled();

    const stale = setup({ results: [finished(verdict())], staleAlready: true });
    expect(await stale.run()).toEqual({
      inputs: [{ type: "RunHeld", reason: "RuntimeFailed" }],
      feedback: null,
    });
    expect(stale.postReview).not.toHaveBeenCalled();
  });

  it("rejects when the review token is missing", async () => {
    const s = setup({
      results: [finished(verdict())],
      env: {},
      review: { mode: "env", tokenEnv: "REVIEW_TOKEN_X" },
    });
    await expect(s.run()).rejects.toThrow(
      "A variável de ambiente REVIEW_TOKEN_X não está definida.",
    );
    expect(s.requests).toHaveLength(0);
  });
});
