import { describe, expect, it } from "vitest";
import { createWorkflow, transition, type WorkflowSnapshot } from "@friday/domain";
import {
  FakeAgentRuntime,
  QA_ALLOWED_MCP,
  QA_ALLOWED_TOOLS,
  runQaStep,
  type QaStepOutcome,
} from "../src/index.ts";
import {
  HEAD,
  finished,
  item,
  makeCriteria,
  makeInput,
  makeRequest,
  passReport,
} from "./qa-step-helpers.ts";

const clean = (value: boolean | Error) => {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    isClean: (p: string, h: string) => {
      calls.push([p, h]);
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    },
  };
};

const run = (
  output: unknown,
  over = {},
  status: Parameters<typeof finished>[1] = "succeeded",
  isClean = true,
) => {
  const runtime = new FakeAgentRuntime([finished(output, status)]);
  return runQaStep({ runtime, worktrees: clean(isClean) }, makeInput(over));
};

const held = (reason: string, violations?: unknown) =>
  expect.objectContaining({
    input: { type: "RunHeld", reason },
    ...(violations === undefined ? {} : { violations }),
  });

describe("runQaStep", () => {
  it("runs a valid QA definition and refuses Edit, Write or a foreign MCP tool before the run", async () => {
    const runtime = new FakeAgentRuntime([finished(passReport())]);
    const ok = await runQaStep({ runtime, worktrees: clean(true) }, makeInput());
    expect(ok.input).toEqual({ type: "QaPassed" });
    expect(runtime.requests).toHaveLength(1);
    const bad = [
      makeRequest(["Read", "Edit"]),
      makeRequest(["Read", "Write"]),
      makeRequest(undefined, ["mcp__friday__git_push"]),
    ];
    for (const request of bad) {
      const rt = new FakeAgentRuntime([finished(passReport())]);
      const out = await runQaStep({ runtime: rt, worktrees: clean(true) }, makeInput({ request }));
      expect(out.input).toEqual({ type: "RunHeld", reason: "RunMisconfigured" });
      expect(rt.requests).toHaveLength(0);
    }
  });

  it("discards the report and reports QaModifiedCode when the worktree is dirty", async () => {
    const wt = clean(false);
    const runtime = new FakeAgentRuntime([finished(passReport())]);
    const out = await runQaStep({ runtime, worktrees: wt }, makeInput());
    expect(out).toEqual({ input: { type: "QaModifiedCode" } });
    expect(wt.calls).toEqual([["/tmp/wt", HEAD]]);
    const created = createWorkflow("i");
    if (!created.ok) throw new Error("workflow");
    const inQa: WorkflowSnapshot = { ...created.value, state: "QA" };
    const next = transition(inQa, out.input);
    expect(next.ok && next.value.snapshot.state).toBe("Held");
    expect(next.ok && next.value.snapshot.heldReason).toBe("QaModifiedCode");
    expect((await run(passReport())).input).toEqual({ type: "QaPassed" });
    const rt2 = new FakeAgentRuntime([finished(passReport())]);
    await expect(
      runQaStep({ runtime: rt2, worktrees: clean(new Error("boom")) }, makeInput()),
    ).rejects.toThrow("boom");
    expect((await run(null, {}, "budget_exceeded", false)).input).toEqual({
      type: "QaModifiedCode",
    });
  });

  it("returns the failed criteria and holds on the third failed round", async () => {
    const report = {
      verdict: "fail",
      criteria: [item(1), item(2, "fail", [], "botão não aparece"), item(3)],
      notChecked: [],
    };
    const out = await run(report);
    expect(out).toEqual({
      input: { type: "QaFailed" },
      failed: [{ index: 2, claim: "claim 2", how: "botão não aparece" }],
      feedback: "Critério 2 reprovado: claim 2 — botão não aparece",
    });
    const created = createWorkflow("i");
    if (!created.ok) throw new Error("workflow");
    let snap: WorkflowSnapshot = { ...created.value, state: "QA" };
    const seen: Array<[string, number, string | null]> = [];
    for (let i = 0; i < 3; i++) {
      const next = transition(snap, out.input);
      if (!next.ok) throw new Error("transition");
      seen.push([
        next.value.snapshot.state,
        next.value.snapshot.qaRound,
        next.value.snapshot.heldReason,
      ]);
      snap = { ...next.value.snapshot, state: "QA" };
    }
    expect(seen.map((s) => s[0])).toEqual(["InProgress", "InProgress", "Held"]);
    expect(seen.map((s) => s[1])).toEqual([1, 2, 3]);
    expect(seen[2]?.[2]).toBe("QaRoundsExhausted");
  });

  it("requires a screenshot for browser criteria when screen paths changed", async () => {
    const screen = {
      changedFiles: ["src/Pages/Home.razor"],
      screenPaths: ["**/*.razor"],
      criteria: makeCriteria(["browser"]),
    };
    const report = (shots: string[]) => ({
      verdict: "pass",
      criteria: [item(1, "pass", shots)],
      notChecked: [],
    });
    expect(await run(report([]), screen)).toEqual({
      input: { type: "RunHeld", reason: "SchemaInvalid" },
      violations: [
        {
          code: "evidence_missing",
          path: "criteria.0.screenshots",
          message: "Critério de tela sem screenshot (criteria.0.screenshots).",
        },
      ],
    });
    expect((await run(report(["shots/1.png"]), screen)).input).toEqual({ type: "QaPassed" });
    expect((await run(report([]), { ...screen, changedFiles: ["src/a.ts"] })).input).toEqual({
      type: "QaPassed",
    });
    expect(
      (await run(report([]), { ...screen, criteria: makeCriteria(["command"]) })).input,
    ).toEqual({ type: "QaPassed" });
  });

  it("holds on a failed run, an invalid report, a pass report that skips criteria and an inconsistent fail report", async () => {
    const outs: QaStepOutcome[] = [];
    const budget = await run(passReport(), {}, "budget_exceeded");
    expect(budget).toEqual(held("BudgetExceeded", []));
    outs.push(budget);
    const empty = await run({ verdict: "pass", criteria: [], notChecked: [] });
    expect(empty).toEqual(held("SchemaInvalid"));
    expect(empty).toHaveProperty("violations", [
      expect.objectContaining({ code: "pass_without_criteria" }),
    ]);
    outs.push(empty, await run(null));
    expect(outs[2]).toEqual(held("SchemaInvalid"));
    const skip = await run({ verdict: "pass", criteria: [item(1), item(2)], notChecked: [] });
    expect(skip).toEqual({
      input: { type: "RunHeld", reason: "SchemaInvalid" },
      violations: [
        {
          code: "required_field",
          path: "criteria",
          message: "Campo obrigatório ausente (criteria).",
        },
      ],
    });
    const ghost = await run({ verdict: "fail", criteria: [item(9, "fail")], notChecked: [] });
    expect(ghost).toEqual({
      input: { type: "RunHeld", reason: "SchemaInvalid" },
      violations: [
        {
          code: "invalid_value",
          path: "criteria.0.index",
          message: "Valor inválido (criteria.0.index).",
        },
      ],
    });
    const noFail = await run({ verdict: "fail", criteria: [item(1), item(2)], notChecked: [] });
    expect(noFail).toEqual({
      input: { type: "RunHeld", reason: "SchemaInvalid" },
      violations: [
        { code: "invalid_value", path: "verdict", message: "Valor inválido (verdict)." },
      ],
    });
    for (const o of [budget, empty, outs[2], skip, ghost, noFail])
      expect(o?.input.type).toBe("RunHeld");
  });

  it("exports the step from the package index", () => {
    expect(typeof runQaStep).toBe("function");
    expect([...QA_ALLOWED_TOOLS]).toEqual(["Read", "Glob", "Grep", "Bash"]);
    expect([...QA_ALLOWED_MCP]).toEqual(["mcp__friday__qa_report", "mcp__friday__issue_comment"]);
  });
});
