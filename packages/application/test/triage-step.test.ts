import { describe, expect, it } from "vitest";
import { DEFAULT_PHASES, transition } from "@friday/domain";
import type { WorkflowInput, WorkflowSnapshot } from "@friday/domain";
import type { RunFinished } from "@friday/contracts";
import * as app from "../src/index.ts";
import {
  FakeAgentRuntime,
  runTriageStep,
  SPECIALIST_LABEL_PREFIX,
  type AgentRunRequest,
  type IssueSummary,
  type TriageStepInput,
} from "../src/index.ts";

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

const issue = (labels: string[] = ["friday"]): IssueSummary => ({
  number: 10,
  title: "API de fotos",
  body: "Criar endpoint",
  labels,
});

const makeRequest = (over: Record<string, unknown> = {}): AgentRunRequest => ({
  cwd: "/tmp/wt",
  prompt: "triage",
  configRoot: "/tmp/cfg",
  agent: {
    model: "haiku",
    states: [],
    maxBudgetUsd: 0.5,
    maxTurns: 5,
    timeoutMs: 1000,
    tools: [],
    allowedTools: [],
    bashAllow: [],
    promptFile: "triage.md",
    outputKind: "triage",
    ...over,
  } as unknown as AgentRunRequest["agent"],
});

const CRITERIA = [
  { index: 1, claim: "a", proof: { kind: "command", command: "pnpm -r test" } },
  { index: 2, claim: "b", proof: { kind: "browser", step: "abrir a tela" } },
];
const good = (specialist: string, reason = "x") => ({ specialist, reason, criteria: CRITERIA });

const flow = { model: "haiku", maxBudgetUsd: 0.5 };

const makeInput = (over: Partial<TriageStepInput> = {}): TriageStepInput => ({
  issue: issue(),
  state: "Triage",
  request: makeRequest(),
  flow,
  staffed: ["backend"],
  ...over,
});

function setup(results: RunFinished[], addLabelFails = false) {
  const runtime = new FakeAgentRuntime(results);
  const calls: string[] = [];
  const labels: Array<[number, string]> = [];
  const comments: Array<[number, string, string]> = [];
  const github = {
    addLabel: (n: number, l: string) => {
      calls.push("addLabel");
      labels.push([n, l]);
      return addLabelFails ? Promise.reject(new Error("falhou")) : Promise.resolve();
    },
    postAgentComment: (n: number, r: string, t: string) => {
      calls.push("postAgentComment");
      comments.push([n, r, t]);
      return Promise.resolve({ created: true });
    },
  };
  return { runtime, github, calls, labels, comments };
}

const snapshotTodo: WorkflowSnapshot = {
  issueId: "10",
  state: "Todo",
  heldReason: null,
  verifyRound: 0,
  qaRound: 0,
  reviewIter: 0,
  phases: DEFAULT_PHASES,
  phaseIndex: 0,
};

function apply(inputs: WorkflowInput[]): WorkflowSnapshot {
  let snap = snapshotTodo;
  for (const input of inputs) {
    const r = transition(snap, input);
    if (!r.ok) throw new Error(`invalid ${input.type}`);
    snap = r.value.snapshot;
  }
  return snap;
}

describe("runTriageStep staffed specialists", () => {
  it("holds with SpecialistWithoutAgent when the chosen specialist has no ficha", async () => {
    const s = setup([finished(good("frontend", "Tela"))]);
    const out = await runTriageStep(s, makeInput({ state: "Todo" }));
    expect(out.inputs).toEqual([
      { type: "NeedsTriage" },
      { type: "RunHeld", reason: "SpecialistWithoutAgent" },
    ]);
    expect(out.specialist).toBeNull();
    expect(out.criteria).toBeNull();
    expect(s.labels).toEqual([[10, "specialist:frontend"]]);
    expect(s.comments).toHaveLength(1);
    const inTriage = setup([finished(good("frontend", "Tela"))]);
    const again = await runTriageStep(inTriage, makeInput());
    expect(again.inputs).toEqual([{ type: "RunHeld", reason: "SpecialistWithoutAgent" }]);
    expect(apply(out.inputs)).toMatchObject({
      state: "Held",
      heldReason: "SpecialistWithoutAgent",
    });
  });

  it("holds when the existing specialist label has no ficha", async () => {
    const s = setup([finished(good("backend"))]);
    const out = await runTriageStep(
      s,
      makeInput({ issue: issue(["friday", "specialist:database"]) }),
    );
    expect(out.inputs).toEqual([{ type: "RunHeld", reason: "SpecialistWithoutAgent" }]);
    expect(out.specialist).toBeNull();
    expect(out.criteria).toBeNull();
    expect(s.labels).toHaveLength(0);
  });

  it("assigns a staffed specialist as before", async () => {
    const s = setup([finished(good("backend"))]);
    const out = await runTriageStep(s, makeInput());
    expect(out.inputs.at(-1)).toEqual({ type: "SpecialistAssigned" });
    expect(out.specialist).toBe("backend");
    expect(out.criteria).toEqual(CRITERIA);
  });
});

describe("runTriageStep", () => {
  it("assigns the backend specialist, labels the issue and comments the reason", async () => {
    const s = setup([finished(good("backend", "Endpoint de API"))]);
    const request = makeRequest();
    const out = await runTriageStep(s, makeInput({ request }));
    expect(s.runtime.requests).toEqual([request]);
    expect(out.inputs).toEqual([{ type: "SpecialistAssigned" }]);
    expect(out.specialist).toBe("backend");
    expect(s.labels).toEqual([[10, "specialist:backend"]]);
    expect(s.comments).toEqual([[10, "triage", 'Triagem: backend. Motivo: "Endpoint de API"']]);
    expect(s.calls).toEqual(["addLabel", "postAgentComment"]);
  });

  it("starts from Todo with NeedsTriage and reaches InProgress", async () => {
    const s = setup([finished(good("frontend", "Tela de listagem"))]);
    const out = await runTriageStep(s, makeInput({ state: "Todo", staffed: ["frontend"] }));
    expect(out.inputs).toEqual([{ type: "NeedsTriage" }, { type: "SpecialistAssigned" }]);
    expect(out.specialist).toBe("frontend");
    expect(s.labels).toEqual([[10, "specialist:frontend"]]);
    expect(s.comments[0]?.[2]).toBe('Triagem: frontend. Motivo: "Tela de listagem"');
    expect(apply(out.inputs).state).toBe("InProgress");
  });

  it("returns the criteria of a valid triage output", async () => {
    const s = setup([finished(good("backend", "API"))]);
    const out = await runTriageStep(s, makeInput());
    expect(s.runtime.requests).toHaveLength(1);
    expect(s.labels).toEqual([[10, "specialist:backend"]]);
    expect(out.specialist).toBe("backend");
    expect(out.criteria).toEqual(CRITERIA);
    expect(out.inputs.at(-1)).toEqual({ type: "SpecialistAssigned" });
  });

  it("runs the triage and keeps the specialist label as the specialist", async () => {
    expect(SPECIALIST_LABEL_PREFIX).toBe("specialist:");
    for (const state of ["Todo", "Triage"] as const) {
      const s = setup([finished(good("backend"))]);
      const out = await runTriageStep(
        s,
        makeInput({
          state,
          issue: issue(["friday", "specialist:database"]),
          staffed: ["database"],
        }),
      );
      expect(s.runtime.requests).toHaveLength(1);
      expect(s.labels).toHaveLength(0);
      expect(out.specialist).toBe("database");
      expect(out.criteria).toEqual(CRITERIA);
      expect(out.inputs.at(-1)).toEqual({ type: "SpecialistAssigned" });
    }
    const first = setup([finished(good("backend"))]);
    const firstOut = await runTriageStep(
      first,
      makeInput({
        issue: issue(["specialist:security", "specialist:backend"]),
        staffed: ["security"],
      }),
    );
    expect(firstOut.specialist).toBe("security");
    const s = setup([finished(good("backend"))]);
    const out = await runTriageStep(
      s,
      makeInput({ issue: issue(["friday", "specialist:planner"]) }),
    );
    expect(s.runtime.requests).toHaveLength(1);
    expect(s.labels).toEqual([[10, "specialist:backend"]]);
    expect(out.specialist).toBe("backend");
  });

  it("holds with SchemaInvalid when the criteria are missing or invalid", async () => {
    const item = { index: 2, claim: "a", proof: { kind: "command", command: "x" } };
    const outputs = [
      { specialist: "backend", reason: "API" },
      { specialist: "backend", reason: "API", criteria: [] },
      { specialist: "backend", reason: "API", criteria: [item] },
    ];
    for (const output of outputs) {
      const s = setup([finished(output)]);
      const out = await runTriageStep(s, makeInput());
      expect(s.calls).toHaveLength(0);
      expect(out.criteria).toBeNull();
      expect(out.inputs.at(-1)).toEqual({ type: "RunHeld", reason: "SchemaInvalid" });
    }
    const s = setup([finished(good("planner"))]);
    const out = await runTriageStep(s, makeInput());
    expect(out.criteria).toBeNull();
    expect(out.inputs.at(-1)).toEqual({ type: "TriageFailed" });
    const labeled = setup([finished({ specialist: "planner", reason: "x" })]);
    const labeledOut = await runTriageStep(
      labeled,
      makeInput({ issue: issue(["specialist:database"]) }),
    );
    expect(labeledOut.inputs.at(-1)).toEqual({ type: "TriageFailed" });
  });

  it("holds with TriageFailed on invalid output", async () => {
    const bad = [
      finished({ specialist: "planner", reason: "x" }),
      finished({ specialist: "backend" }),
      finished(null, "invalid_output"),
    ];
    for (const result of bad) {
      for (const state of ["Triage", "Todo"] as const) {
        const s = setup([result]);
        const out = await runTriageStep(s, makeInput({ state }));
        const failed = { type: "TriageFailed" };
        expect(out.inputs).toEqual(
          state === "Triage" ? [failed] : [{ type: "NeedsTriage" }, failed],
        );
        expect(out.specialist).toBeNull();
        expect(s.calls).toHaveLength(0);
      }
    }
    const s = setup([finished({ specialist: "planner", reason: "x" })]);
    const out = await runTriageStep(s, makeInput({ state: "Todo" }));
    const final = apply(out.inputs);
    expect(final.state).toBe("Held");
    expect(final.heldReason).toBe("TriageFailed");
  });

  it("maps a failed run to RunHeld", async () => {
    const budget = setup([finished(null, "budget_exceeded")]);
    expect((await runTriageStep(budget, makeInput())).inputs).toEqual([
      { type: "RunHeld", reason: "BudgetExceeded" },
    ]);
    const timeout = setup([finished(null, "timeout")]);
    expect((await runTriageStep(timeout, makeInput())).inputs).toEqual([
      { type: "RunHeld", reason: "RuntimeFailed" },
    ]);
    expect(budget.calls).toHaveLength(0);
    expect(timeout.calls).toHaveLength(0);
  });

  it("refuses a request that breaks the triage config", async () => {
    const broken = [
      makeRequest({ maxBudgetUsd: 1 }),
      makeRequest({ model: "sonnet" }),
      makeRequest({ tools: ["Bash"] }),
      makeRequest({ allowedTools: ["mcp__friday__issue_comment"] }),
      makeRequest({ allowedTools: ["mcp__friday__criteria_set"] }),
      makeRequest({ outputKind: "qaReport" }),
    ];
    for (const request of broken) {
      const s = setup([finished(good("backend"))]);
      const out = await runTriageStep(s, makeInput({ request }));
      expect(out.inputs).toEqual([{ type: "RunHeld", reason: "RunMisconfigured" }]);
      expect(s.runtime.requests).toHaveLength(0);
    }
    const s = setup([]);
    const out = await runTriageStep(s, makeInput({ state: "Todo", request: broken[0] }));
    expect(out.inputs).toEqual([
      { type: "NeedsTriage" },
      { type: "RunHeld", reason: "RunMisconfigured" },
    ]);
    const ok = setup([finished(good("infra"))]);
    await runTriageStep(ok, makeInput());
    expect(ok.runtime.requests).toHaveLength(1);
  });

  it("rejects other states and stops when addLabel fails", async () => {
    const s = setup([]);
    await expect(runTriageStep(s, makeInput({ state: "QA" as "Todo" }))).rejects.toThrow(
      "Estado sem triagem: QA",
    );
    const f = setup([finished(good("backend"))], true);
    await expect(runTriageStep(f, makeInput())).rejects.toThrow();
    expect(f.comments).toHaveLength(0);
  });

  it("exports the triage step from the package index", () => {
    expect(typeof app.runTriageStep).toBe("function");
    expect(app.SPECIALIST_LABEL_PREFIX).toBe("specialist:");
  });
});
