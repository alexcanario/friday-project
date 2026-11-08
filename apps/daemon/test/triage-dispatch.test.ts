import { describe, expect, it } from "vitest";
import { criteriaOf, runTriageForIssue } from "../src/index.ts";
import { CRITERIA, GOOD, finished, triageSetup } from "./triage-fakes.ts";

const NOW_ISO = "2026-11-05T03:00:00.000Z";
const OK = { applied: true, feedback: null };
const NOT = { applied: false, feedback: null };

describe("runTriageForIssue", () => {
  it("labels, comments and moves a Triage issue to InProgress", async () => {
    const t = triageSetup({ state: "Triage" });
    await expect(runTriageForIssue(t.deps, t.issue)).resolves.toEqual(OK);
    expect(t.runtime.run).toHaveBeenCalledTimes(1);
    expect(t.github.calls).toEqual([
      "addLabel:10:specialist:backend",
      "postAgentComment:10:triage",
    ]);
    expect(t.github.commentCalls[0]?.text).toBe('Triagem: backend. Motivo: "Endpoint de API"');
    expect(t.row()?.state).toBe("InProgress");
    const changes = t.stateEvents();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ from: "Triage", to: "InProgress" });
    const changed = t.events.list("p", 10).filter((e) => e.type === "StateChanged");
    expect(changed.at(-1)?.runId).toBe("r1");
    expect(t.runs.get("r1")?.status).toBe("succeeded");
    expect(t.events.list("p", 10).filter((e) => e.type === "RunFinished")).toHaveLength(1);
  });

  it("moves a Todo issue through Triage to InProgress", async () => {
    const t = triageSetup({
      results: [finished({ ...GOOD, specialist: "backend", reason: "Endpoint de listagem" })],
    });
    await runTriageForIssue(t.deps, t.issue);
    expect(t.github.labelCalls).toEqual([{ issue: 10, label: "specialist:backend" }]);
    expect(t.stateEvents().map((e) => `${e.from}>${e.to}`)).toEqual([
      "Todo>Triage",
      "Triage>InProgress",
    ]);
    expect(t.row()?.state).toBe("InProgress");
  });

  it("holds with TriageFailed on invalid output, not SchemaInvalid", async () => {
    const outputs = [
      finished(null, "invalid_output"),
      finished({ specialist: "planner", reason: "x" }),
      finished({ specialist: "backend" }),
    ];
    for (const state of ["Todo", "Triage"] as const) {
      for (const result of outputs) {
        const t = triageSetup({ state, results: [result] });
        await expect(runTriageForIssue(t.deps, t.issue)).resolves.toEqual(OK);
        expect(t.row()?.state).toBe("Held");
        expect(t.row()?.heldReason).toBe("TriageFailed");
        expect(t.github.calls).toEqual([]);
        if (result.status === "invalid_output") expect(t.runs.get("r1")?.status).toBe("failed");
      }
    }
  });

  it("holds once on a failed run and records the cost", async () => {
    const cases = [
      ["budget_exceeded", "BudgetExceeded"],
      ["timeout", "RuntimeFailed"],
    ] as const;
    for (const [status, reason] of cases) {
      const t = triageSetup({ state: "Triage", results: [finished(null, status, 0.2)] });
      await runTriageForIssue(t.deps, t.issue);
      expect(t.row()?.state).toBe("Held");
      expect(t.row()?.heldReason).toBe(reason);
      expect(t.stateEvents()).toHaveLength(1);
      expect(t.ledger.sumByIssue("p", 10)).toEqual({ costUsd: 0.2, anyCostUnknown: false });
      expect(t.github.calls).toEqual([]);
    }
  });

  it("appends CriteriaSet before the state change", async () => {
    const t = triageSetup({ state: "Triage" });
    await runTriageForIssue(t.deps, t.issue);
    const all = t.events.list("p", 10);
    const sets = all.filter((e) => e.type === "CriteriaSet");
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({
      payload: { criteria: CRITERIA },
      actor: "daemon",
      runId: "r1",
      at: NOW_ISO,
    });
    const lastChange = all.filter((e) => e.type === "StateChanged").at(-1)!;
    expect(all.indexOf(sets[0]!)).toBeLessThan(all.indexOf(lastChange));
    expect(criteriaOf(all)).toEqual(CRITERIA);
  });

  it("records no CriteriaSet and holds with SchemaInvalid on invalid criteria", async () => {
    const item = { index: 2, claim: "a", proof: { kind: "command", command: "x" } };
    const outputs = [
      { specialist: "backend", reason: "API" },
      { specialist: "backend", reason: "API", criteria: [item] },
    ];
    for (const output of outputs) {
      const t = triageSetup({ results: [finished(output)] });
      await runTriageForIssue(t.deps, t.issue);
      expect(t.events.list("p", 10).filter((e) => e.type === "CriteriaSet")).toHaveLength(0);
      expect(t.row()?.state).toBe("Held");
      expect(t.row()?.heldReason).toBe("SchemaInvalid");
      expect(t.stateEvents().some((e) => e.to === "InProgress")).toBe(false);
    }
  });

  it("records CriteriaSet for an issue with a specialist label", async () => {
    const t = triageSetup({ labels: ["friday", "specialist:backend"] });
    await runTriageForIssue(t.deps, t.issue);
    expect(t.runtime.run).toHaveBeenCalledTimes(1);
    expect(t.events.list("p", 10).filter((e) => e.type === "CriteriaSet")).toHaveLength(1);
    expect(t.github.calls.some((c) => c.startsWith("addLabel"))).toBe(false);
    expect(t.row()?.state).toBe("InProgress");
  });

  it("stops on budget cap, missing config, GitHub failure and runtime rejection", async () => {
    const cap = triageSetup({ state: "Triage" });
    cap.ledger.record({
      projectId: "p",
      issueId: 10,
      runId: "x",
      day: "2026-11-05",
      costUsd: 4.1,
      costUnknown: false,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      numTurns: null,
    });
    await runTriageForIssue(cap.deps, cap.issue);
    expect(cap.runtime.run).not.toHaveBeenCalled();
    expect(cap.row()?.heldReason).toBe("IssueBudgetExceeded");
    const todo = triageSetup();
    todo.ledger.record({
      projectId: "p",
      issueId: 10,
      runId: "x",
      day: "2026-11-05",
      costUsd: 4.1,
      costUnknown: false,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      numTurns: null,
    });
    await runTriageForIssue(todo.deps, todo.issue);
    expect(todo.row()?.state).toBe("Todo");
    expect(todo.log).toHaveBeenCalledWith(
      "Budget cap IssueBudgetExceeded for issue 10 but RunHeld was not accepted",
    );

    const noFlow = triageSetup({ flow: false });
    await runTriageForIssue(noFlow.deps, noFlow.issue);
    expect(noFlow.runtime.run).not.toHaveBeenCalled();
    expect(noFlow.log).toHaveBeenCalledWith(
      "Falha na triagem da issue 10: O factory.yaml está inválido ou ausente.",
    );

    for (const state of ["Todo", "Triage"] as const) {
      const gh = triageSetup({ state });
      gh.github.addLabelFailure = new Error("falha");
      await expect(runTriageForIssue(gh.deps, gh.issue)).resolves.toEqual(NOT);
      expect(gh.github.commentCalls).toHaveLength(0);
      expect(gh.row()?.state).toBe(state);
      expect(gh.log).toHaveBeenCalledWith("Falha na triagem da issue 10: falha");
    }

    const rt = triageSetup({ state: "Triage", rejectRun: true });
    await expect(runTriageForIssue(rt.deps, rt.issue)).resolves.toEqual(NOT);
    expect(rt.runs.get("r1")?.status).toBe("failed");
    expect(rt.ledger.sumByIssue("p", 10)).toEqual({ costUsd: 0.5, anyCostUnknown: true });
    expect(rt.log).toHaveBeenCalledWith("Falha na triagem da issue 10: queda");
    expect(GOOD.specialist).toBe("backend");
  });
});

describe("runTriageForIssue without a runtime", () => {
  it("fails the run without runtime and runtimeFor", async () => {
    const t = triageSetup({ state: "Triage" });
    delete (t.deps as { runtime?: unknown }).runtime;
    await expect(runTriageForIssue(t.deps, t.issue)).resolves.toEqual(NOT);
    expect(t.runs.get("r1")?.status).toBe("failed");
    expect(t.runs.get("r1")?.finishedAt).not.toBeNull();
    expect(t.log).toHaveBeenCalledWith(
      "Falha na triagem da issue 10: Nenhum runtime configurado para a run.",
    );
    expect(t.github.calls).toEqual([]);
  });
});
