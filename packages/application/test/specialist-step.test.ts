import { describe, expect, it } from "vitest";
import { createWorkflow, transition, type WorkflowInput } from "@friday/domain";
import type { RunFinished } from "@friday/contracts";
import * as app from "../src/index.ts";
import {
  FakeAgentRuntime,
  SPECIALIST_ALLOWED_MCP,
  runSpecialistStep,
  type AgentRunRequest,
  type AgentRuntime,
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

const makeRequest = (agentOver: Record<string, unknown> = {}): AgentRunRequest => ({
  cwd: "/tmp/wt",
  prompt: "backend",
  configRoot: "/tmp/cfg",
  agent: {
    model: "sonnet",
    states: ["InProgress"],
    maxBudgetUsd: 1,
    maxTurns: 10,
    timeoutMs: 1000,
    tools: ["Read", "Glob", "Grep", "Bash", "Edit", "Write"],
    allowedTools: [
      "mcp__friday__criteria_set",
      "mcp__friday__work_report",
      "mcp__friday__git_push",
      "mcp__friday__pr_create",
    ],
    bashAllow: [],
    promptFile: "prompts/backend.md",
    outputKind: "workReport",
    ...agentOver,
  } as unknown as AgentRunRequest["agent"],
});

const report = {
  summary: "Adiciona GET /version",
  headSha: "a".repeat(40),
  changedFiles: ["src/Version.cs"],
  notDone: [],
};

const created = createWorkflow("10");
if (!created.ok) throw new Error("createWorkflow failed");
const snapshot = created.value;

const PC = { type: "PhaseCompleted" } as const;
const WR = { type: "WorkReported" } as const;

describe("runSpecialistStep", () => {
  it("returns the work report and WorkReported for a valid run", async () => {
    const runtime = new FakeAgentRuntime([finished(report)]);
    const request = makeRequest();
    const out = await runSpecialistStep({ runtime }, { request, snapshot });
    expect(out).toEqual({ report, inputs: [PC, WR] });
    expect(runtime.requests).toHaveLength(1);
    expect(runtime.requests[0]).toBe(request);
  });

  it("repeats PhaseCompleted for each remaining phase", async () => {
    const run = (s: object) =>
      runSpecialistStep(
        { runtime: new FakeAgentRuntime([finished(report)]) },
        { request: makeRequest(), snapshot: s as typeof snapshot },
      );
    const done = await run({ phases: snapshot.phases, phaseIndex: 1 });
    expect("inputs" in done && done.inputs).toEqual([WR]);
    const two = await run({ phases: [...snapshot.phases, ...snapshot.phases], phaseIndex: 0 });
    expect("inputs" in two && two.inputs).toEqual([PC, PC, WR]);
  });

  it("takes the issue from InProgress to Verify with the real transition", async () => {
    const out = await runSpecialistStep(
      { runtime: new FakeAgentRuntime([finished(report)]) },
      { request: makeRequest(), snapshot },
    );
    if (!("report" in out)) throw new Error("expected report");
    let cur = snapshot;
    for (const input of [{ type: "Admitted" }, { type: "SpecialistAssigned" }] as WorkflowInput[]) {
      const r = transition(cur, input);
      if (!r.ok) throw new Error("setup failed");
      cur = r.value;
    }
    expect(cur.state).toBe("InProgress");
    const only = transition(cur, WR);
    expect(only.ok).toBe(false);
    for (const input of out.inputs) {
      const r = transition(cur, input);
      expect(r.ok).toBe(true);
      if (r.ok) cur = r.value;
    }
    expect(cur.state).toBe("Verify");
  });

  it("refuses a request that breaks the specialist config", async () => {
    const bad = [
      { allowedTools: ["mcp__friday__qa_report"] },
      { outputKind: "qaReport" },
      { states: ["QA"] },
    ];
    for (const over of bad) {
      const runtime = new FakeAgentRuntime([finished(report)]);
      const out = await runSpecialistStep({ runtime }, { request: makeRequest(over), snapshot });
      expect(out).toEqual({
        inputs: [{ type: "RunHeld", reason: "RunMisconfigured" }],
        violations: [],
      });
      expect(runtime.requests).toHaveLength(0);
    }
  });

  it("holds with SchemaInvalid on an invalid work report", async () => {
    for (const output of [{ ...report, headSha: "abc" }, null, { summary: "x" }]) {
      const out = await runSpecialistStep(
        { runtime: new FakeAgentRuntime([finished(output)]) },
        { request: makeRequest(), snapshot },
      );
      expect(out).not.toHaveProperty("report");
      expect(out.inputs).toEqual([{ type: "RunHeld", reason: "SchemaInvalid" }]);
      expect("violations" in out && out.violations.length).toBeGreaterThan(0);
    }
  });

  it("maps a failed run to RunHeld and drops the output", async () => {
    const cases: Array<[RunFinished["status"], string]> = [
      ["budget_exceeded", "BudgetExceeded"],
      ["turns_exceeded", "TurnsExceeded"],
      ["timeout", "RuntimeFailed"],
      ["invalid_output", "SchemaInvalid"],
      ["misconfigured", "RunMisconfigured"],
    ];
    for (const [status, reason] of cases) {
      const out = await runSpecialistStep(
        { runtime: new FakeAgentRuntime([finished(report, status)]) },
        { request: makeRequest(), snapshot },
      );
      expect(out).toEqual({ inputs: [{ type: "RunHeld", reason }], violations: [] });
    }
  });

  it("propagates a runtime rejection", async () => {
    const runtime: AgentRuntime = { run: () => Promise.reject(new Error("boom")) };
    await expect(
      runSpecialistStep({ runtime }, { request: makeRequest(), snapshot }),
    ).rejects.toThrow("boom");
  });

  it("exports the specialist step from the package index", () => {
    expect(typeof app.runSpecialistStep).toBe("function");
    expect(SPECIALIST_ALLOWED_MCP).toContain("mcp__friday__work_report");
  });
});
