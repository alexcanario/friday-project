import { describe, expect, it } from "vitest";
import type { StoredEvent } from "@friday/application";
import { buildSpecialistRequest, criteriaOf, feedbackOf } from "../src/index.ts";

const agent = {
  model: "sonnet",
  states: ["InProgress"],
  maxBudgetUsd: 1,
  maxTurns: 5,
  timeoutMs: 60000,
  tools: ["Read"],
  allowedTools: ["mcp__friday__work_report"],
  bashAllow: [],
  promptFile: "backend.md",
  outputKind: "workReport",
} as unknown as Parameters<typeof buildSpecialistRequest>[0]["agent"];

const criteria = [
  {
    index: 1,
    claim: "Retorna 200",
    proof: { kind: "command" as const, command: "curl localhost/version" },
  },
  {
    index: 2,
    claim: "Mostra a versão",
    proof: { kind: "browser" as const, step: "abrir /version" },
  },
];

function input(over: Partial<Parameters<typeof buildSpecialistRequest>[0]> = {}) {
  return {
    issue: { number: 7, title: "Adiciona GET /version", body: "Corpo" },
    criteria: null,
    feedback: null,
    agent,
    friday: {
      runId: "run-1",
      agent: { states: ["InProgress"], mcp_tools: ["work_report"] },
      getIssueState: () => "InProgress" as const,
    },
    cwd: "/tmp/wt",
    configRoot: "/cfg",
    branch: "friday/7-version",
    base: "develop",
    getPullRequest: () => 42,
    ...over,
  } as Parameters<typeof buildSpecialistRequest>[0];
}

const ev = (seq: number, type: string, payload: unknown = {}): StoredEvent =>
  ({
    seq,
    type,
    payload,
    projectId: "p",
    issueId: 7,
    runId: null,
    actor: "daemon",
    at: "2026-11-07T00:00:00.000Z",
  }) as StoredEvent;

describe("buildSpecialistRequest", () => {
  it("builds the prompt, the criteria and feedback sections, the run id and the effects run", () => {
    const head = "Issue #7: Adiciona GET /version\n\nCorpo";
    expect(buildSpecialistRequest(input()).prompt).toBe(head);
    expect(buildSpecialistRequest(input({ feedback: "Falhou X" })).prompt).toBe(
      `${head}\n\nFeedback da rodada anterior:\nFalhou X`,
    );
    const full = buildSpecialistRequest(input({ criteria, feedback: "Falhou X" }));
    expect(full.prompt).toBe(
      `${head}\n\nCritérios de aceite:\n1. Retorna 200 [command: curl localhost/version]\n2. Mostra a versão [browser: abrir /version]\n\nFeedback da rodada anterior:\nFalhou X`,
    );
    const getPullRequest = () => 42;
    const request = buildSpecialistRequest(input({ getPullRequest }));
    expect(request.friday?.runId).toBe("run-1");
    expect(request.friday?.effects?.run).toEqual({
      issue: 7,
      role: "specialist",
      branch: "friday/7-version",
      base: "develop",
      worktree: "/tmp/wt",
      getPullRequest,
    });
    expect(request.friday?.effects?.run.getPullRequest()).toBe(42);
    expect(request.cwd).toBe("/tmp/wt");
    expect(request.configRoot).toBe("/cfg");
    expect(request.agent).toBe(agent);
  });

  it("throws for a branch equal to base, another issue branch or an invalid issue number", () => {
    expect(() => buildSpecialistRequest(input({ branch: "develop" }))).toThrow(Error);
    expect(() => buildSpecialistRequest(input({ branch: "friday/8-x" }))).toThrow(Error);
    expect(() =>
      buildSpecialistRequest(input({ issue: { number: 0, title: "t", body: "b" } })),
    ).toThrow(Error);
  });
});

describe("feedbackOf", () => {
  it("returns the latest QA, Judge or Verify feedback after the last WorkReported", () => {
    const qa = ev(1, "QaFinished", { feedback: "a" });
    const work = ev(2, "WorkReported");
    const judge = ev(3, "JudgeFinished", { feedback: "b" });
    expect(feedbackOf([qa, work, judge])).toBe("b");
    expect(feedbackOf([qa, work, judge, ev(4, "WorkReported")])).toBeNull();
    expect(feedbackOf([qa, ev(2, "JudgeFinished", { feedback: "b" })])).toBe("b");
    expect(
      feedbackOf([
        ev(1, "JudgeFinished", { feedback: "b" }),
        ev(2, "VerifyFinished", { feedback: "v" }),
      ]),
    ).toBe("v");
    expect(feedbackOf([ev(1, "QaFinished", { outcome: "qa_failed" })])).toBeNull();
    expect(feedbackOf([ev(1, "QaFinished", { feedback: 3 })])).toBeNull();
    expect(feedbackOf([])).toBeNull();
  });

  it("feedbackOf ignores a JudgeFinished without feedback", () => {
    const approved = ev(1, "JudgeFinished", { outcome: "approve", reviewId: 501 });
    expect(feedbackOf([approved])).toBeNull();
    expect(
      feedbackOf([ev(1, "JudgeFinished", { feedback: "1. x", reviewId: 501 }), approved]),
    ).toBe("1. x");
    expect(feedbackOf([ev(1, "JudgeFinished", { feedback: "1. x" })])).toBe("1. x");
  });
});

describe("criteriaOf", () => {
  it("returns the latest valid CriteriaSet criteria or null", () => {
    const one = [criteria[0]];
    expect(criteriaOf([ev(1, "CriteriaSet", { criteria: one })])).toEqual(one);
    expect(
      criteriaOf([
        ev(1, "CriteriaSet", { criteria: criteria }),
        ev(3, "CriteriaSet", { criteria: one }),
        ev(4, "WorkReported"),
      ]),
    ).toEqual(one);
    expect(criteriaOf([ev(1, "CriteriaSet", { criteria: [] })])).toBeNull();
    const bad = [{ index: 2, claim: "x", proof: { kind: "command", command: "y" } }];
    expect(criteriaOf([ev(1, "CriteriaSet", { criteria: bad })])).toBeNull();
    expect(criteriaOf([])).toBeNull();
  });
});
