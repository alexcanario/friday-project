import { describe, expect, it, vi } from "vitest";
import { FakeAgentRuntime, type IssueRow, type StoredEvent } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import { createRunRecorder } from "../src/index.ts";
import { runQaForIssue } from "../src/qa-dispatch.ts";
import {
  buildQaStepInput,
  qaTargetOf,
  type QaContext,
  type QaRequestInput,
} from "../src/qa-request.ts";
import { FakeEvents, FakeIssueRepository, FakeRunRepository, slackBudget } from "./fakes.ts";

const SHA = "a".repeat(40);
const report = { worktreePath: "/tmp/wt", headSha: SHA, changedFiles: ["src/Version.cs"] };
const criteria = [
  {
    index: 1,
    claim: "Retorna 200",
    proof: { kind: "command" as const, command: "curl localhost/version" },
  },
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
  screenPaths: [],
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
const base = [ev(1, "CriteriaSet", { criteria }), ev(2, "WorkReported", report)];

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
  criteria: [{ index: 1, result: "pass", how: "ok", screenshots: [] }],
  notChecked: [],
};

function e2e(log: ((m: string) => void) | undefined) {
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
  for (const [type, payload] of [
    ["CriteriaSet", { criteria }],
    ["WorkReported", report],
  ] as const)
    events.append({
      projectId: "p",
      issueId: 7,
      runId: null,
      type,
      payload,
      actor: "daemon",
      at: "2026-11-05T03:00:00.000Z",
    });
  const fake = new FakeAgentRuntime([finished(pass)]);
  const now = () => new Date("2026-11-05T03:00:00.000Z");
  const recorderDeps = { projectId: "p", events, issues, now };
  const deps = {
    projectId: "p",
    targetOf: qaTargetOf({
      projectId: "p",
      events,
      context: (_i, runId) => ({ ...context, friday: { ...context.friday, runId } }),
      ...(log === undefined ? {} : { log }),
    }),
    step: { runtime: fake, worktrees: { isClean: async () => true } },
    recorder: recorderDeps,
    recording: {
      runs: new FakeRunRepository(order),
      recorder: createRunRecorder(recorderDeps),
      newRunId: () => "r1",
    },
    ...slackBudget(recorderDeps),
    now,
  };
  return { deps, fake };
}

describe("qa effect error hook", () => {
  it("buildQaStepInput sets onEffectError on the run only when given", () => {
    const hook = () => undefined;
    const withHook = buildQaStepInput({ ...input, onEffectError: hook }).request.friday!.effects!
      .run;
    const without = buildQaStepInput(input).request.friday!.effects!.run;
    expect(withHook.onEffectError).toBe(hook);
    expect(without.onEffectError).toBeUndefined();
    for (const run of [withHook, without]) {
      expect(run.issue).toBe(7);
      expect(run.role).toBe("qa");
      expect(run.branch).toBe("friday/7-version");
      expect(run.base).toBe("develop");
      expect(run.worktree).toBe("/tmp/wt");
    }
  });

  it("qaTargetOf logs the failed tool and issue through log", () => {
    const log = vi.fn<(m: string) => void>();
    const target = qaTargetOf({
      projectId: "p",
      events: eventsOf(base),
      context: () => context,
      log,
    })(7, "run-1");
    const hook = target!.request.friday!.effects!.run.onEffectError;
    expect(typeof hook).toBe("function");
    hook!("pr_create", new Error("falha"));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("Falha na ferramenta pr_create da issue 7: Error: falha");
  });

  it("does not throw without log and keeps the verdict", async () => {
    const target = qaTargetOf({ projectId: "p", events: eventsOf(base), context: () => context })(
      7,
      "run-1",
    );
    expect(target).not.toBeNull();
    expect(target!.request.friday!.effects!.run.onEffectError).toBeUndefined();
    const t = e2e(undefined);
    await expect(runQaForIssue(t.deps, 7)).resolves.toEqual({ applied: true, feedback: null });
    const run = t.fake.requests[0]!.friday!.effects!.run;
    expect(run.onEffectError).toBeUndefined();
  });

  it("ignores an onEffectError coming from the context", () => {
    const own = vi.fn();
    const hostile = { ...context, onEffectError: own } as unknown as QaContext;
    const log = vi.fn<(m: string) => void>();
    const withLog = qaTargetOf({
      projectId: "p",
      events: eventsOf(base),
      context: () => hostile,
      log,
    })(7, "run-1");
    withLog!.request.friday!.effects!.run.onEffectError!("pr_create", new Error("falha"));
    expect(own).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Falha na ferramenta pr_create da issue 7: Error: falha");
    const noLog = qaTargetOf({ projectId: "p", events: eventsOf(base), context: () => hostile })(
      7,
      "run-1",
    );
    expect(noLog!.request.friday!.effects!.run.onEffectError).toBeUndefined();
  });

  it("still throws for an invalid branch with a hook", () => {
    const onEffectError = () => undefined;
    for (const branch of ["develop", "friday/8-x"])
      expect(() => buildQaStepInput({ ...input, branch, onEffectError })).toThrow(Error);
    expect(() =>
      buildQaStepInput({ ...input, issue: { ...input.issue, number: 0 }, onEffectError }),
    ).toThrow(Error);
  });
});
