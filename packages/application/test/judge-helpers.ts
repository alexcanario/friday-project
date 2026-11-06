import type { ReviewVerdict } from "@friday/contracts";
import { createWorkflow, type WorkflowSnapshot } from "@friday/domain";
import {
  FakeAgentRuntime,
  runJudgeStep,
  type AgentRunOptions,
  type JudgeStepDeps,
  type JudgeStepInput,
  type StaleVerdicts,
} from "../src/index.ts";
import { finished } from "./qa-step-helpers.ts";

export const A = "a".repeat(40);
export const B = "b".repeat(40);
export const TOKEN = "ghs_marker_token";

export const rules = (): ReviewVerdict["rules"] =>
  [1, 2, 3, 4, 5].map((n) => ({ rule: n, answer: "yes" as const, evidence: `ok-${n}` }));

export const verdict = (over: Record<string, unknown> = {}): unknown => ({
  verdict: "approve",
  headSha: A,
  rules: rules(),
  findings: [],
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

export const makeAgents = (
  over: Partial<AgentRunOptions> = {},
): Record<"judge" | "judge-strong", AgentRunOptions> => ({
  judge: { ...base, model: "sonnet", ...over } as unknown as AgentRunOptions,
  "judge-strong": { ...base, model: "opus" } as unknown as AgentRunOptions,
});

export class MemoryStale implements StaleVerdicts {
  readonly marked: Array<[string, number, string]> = [];
  markStale(p: string, i: number, h: string): void {
    this.marked.push([p, i, h]);
  }
  isStale(p: string, i: number, h: string): boolean {
    return this.marked.some((m) => m[0] === p && m[1] === i && m[2] === h);
  }
}

export type Posted = [number, { commitId: string; body: string; event: string }];

export function setup(
  output: unknown,
  opts: {
    head?: string;
    status?: Parameters<typeof finished>[1];
    postFail?: Error;
    agents?: Record<"judge" | "judge-strong", AgentRunOptions>;
    body?: string;
    labels?: string[];
    env?: Record<string, string | undefined>;
    reviewTokenEnv?: string | undefined;
    stale?: MemoryStale;
  } = {},
) {
  const runtime = new FakeAgentRuntime([finished(output, opts.status ?? "succeeded")]);
  const stale = opts.stale ?? new MemoryStale();
  const posted: Posted[] = [];
  const tokens: string[] = [];
  const reads: number[] = [];
  let head = opts.head ?? A;
  const deps: JudgeStepDeps = {
    runtime,
    stale,
    readPrHead: (pr) => {
      reads.push(pr);
      return Promise.resolve(head);
    },
    reviewer: (token) => {
      tokens.push(token);
      return {
        postReview: (pr, review) => {
          posted.push([pr, review]);
          return opts.postFail ? Promise.reject(opts.postFail) : Promise.resolve({ id: 501 });
        },
      };
    },
    env: opts.env ?? { FRIDAY_JUDGE_TOKEN: TOKEN },
    reviewTokenEnv: "reviewTokenEnv" in opts ? opts.reviewTokenEnv : "FRIDAY_JUDGE_TOKEN",
    agents: opts.agents ?? makeAgents(),
  };
  const input: JudgeStepInput = {
    projectId: "p",
    issue: { id: 7, body: opts.body ?? "- risco: low — texto", labels: opts.labels ?? ["friday"] },
    pr: 30,
    cwd: "/tmp/wt",
    prompt: "judge",
    configRoot: "/tmp/cfg",
  };
  return {
    runtime,
    stale,
    posted,
    tokens,
    reads,
    deps,
    input,
    setHead: (h: string) => {
      head = h;
    },
    run: () => runJudgeStep(deps, input),
  };
}

export const inReview = (reviewIter = 0): WorkflowSnapshot => {
  const created = createWorkflow("i");
  if (!created.ok) throw new Error("workflow");
  return { ...created.value, state: "InReview", reviewIter };
};
