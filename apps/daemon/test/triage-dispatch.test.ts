import { describe, expect, it } from "vitest";
import { runTriageForIssue } from "../src/index.ts";
import { GOOD, finished, triageSetup } from "./triage-fakes.ts";

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
      results: [finished({ specialist: "frontend", reason: "Tela de listagem" })],
    });
    await runTriageForIssue(t.deps, t.issue);
    expect(t.github.labelCalls).toEqual([{ issue: 10, label: "specialist:frontend" }]);
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

  it("skips the runtime when the issue already has a specialist label", async () => {
    const t = triageSetup({ labels: ["friday", "specialist:database"] });
    await runTriageForIssue(t.deps, t.issue);
    expect(t.runtime.run).not.toHaveBeenCalled();
    expect(t.runs.list("p")).toHaveLength(0);
    expect(t.github.calls).toEqual([]);
    expect(t.row()?.state).toBe("InProgress");
    const p = triageSetup({ labels: ["friday", "specialist:planner"] });
    await runTriageForIssue(p.deps, p.issue);
    expect(p.runtime.run).toHaveBeenCalledTimes(1);
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
