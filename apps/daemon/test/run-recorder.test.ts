import { readFileSync } from "node:fs";
import type { RunFinished } from "@friday/contracts";
import { describe, expect, it } from "vitest";
import { createRunRecorder } from "../src/index.ts";
import { FakeEvents, FakeIssueRepository } from "./fakes.ts";

const AT = "2026-11-05T03:00:00.000Z";
const CTX = { runId: "r1", issueId: 7 };

function finished(status: RunFinished["status"]): RunFinished {
  return {
    status,
    subtype: null,
    model: null,
    costUsd: null,
    tokens: null,
    numTurns: null,
    durationMs: null,
    output: null,
    violations: [],
  };
}

function setup(state = "InProgress", heldReason: string | null = null, hasRow = true) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events);
  if (hasRow) {
    issues.row = {
      projectId: "p",
      issueId: 7,
      state,
      heldReason,
      verifyRound: 0,
      qaRound: 0,
      reviewIter: 0,
    };
  }
  const recorder = createRunRecorder({ projectId: "p", events, issues, now: () => new Date(AT) });
  return { events, issues, recorder };
}

describe("run recorder", () => {
  it("records RunFinished and applies RunHeld for budget_exceeded", () => {
    const { events, issues, recorder } = setup();
    const f = finished("budget_exceeded");
    recorder.recordFinished(CTX, f);
    expect(events.appended).toEqual([
      {
        type: "RunFinished",
        projectId: "p",
        issueId: 7,
        runId: "r1",
        actor: "daemon",
        at: AT,
        payload: f,
      },
      {
        type: "StateChanged",
        projectId: "p",
        issueId: 7,
        runId: "r1",
        actor: "daemon",
        at: AT,
        payload: {
          type: "StateChanged",
          issueId: "7",
          from: "InProgress",
          to: "Held",
          trigger: "RunHeld",
          heldReason: "BudgetExceeded",
          verifyRound: 0,
          qaRound: 0,
          reviewIter: 0,
        },
      },
    ]);
    expect(issues.rebuilds).toEqual([{ projectId: "p", appendedCount: 2 }]);
  });

  it("records only RunFinished when the run succeeded", () => {
    const { events, issues, recorder } = setup();
    recorder.recordFinished(CTX, finished("succeeded"));
    expect(events.appended.map((e) => e.type)).toEqual(["RunFinished"]);
    expect(issues.rebuilds).toEqual([]);
  });

  it("maps each failing status to its held reason", () => {
    const table: [RunFinished["status"], string][] = [
      ["turns_exceeded", "TurnsExceeded"],
      ["invalid_output", "SchemaInvalid"],
      ["timeout", "RuntimeFailed"],
      ["misconfigured", "RunMisconfigured"],
      ["failed", "RuntimeFailed"],
    ];
    for (const [status, reason] of table) {
      const { events, recorder } = setup();
      recorder.recordFinished(CTX, finished(status));
      const changed = events.appended.find((e) => e.type === "StateChanged");
      expect((changed?.payload as { heldReason: string }).heldReason).toBe(reason);
    }
  });

  it("records only RunFinished when the issue cannot be held, including an unknown heldReason", () => {
    const cases = [
      setup("Todo"),
      setup("Held", "Reconciled"),
      setup("Held", "Bogus"),
      setup("InProgress", "Bogus"),
      setup("Nonsense"),
      setup("InProgress", null, false),
    ];
    for (const { events, issues, recorder } of cases) {
      expect(() => recorder.recordFinished(CTX, finished("budget_exceeded"))).not.toThrow();
      expect(events.appended.map((e) => e.type)).toEqual(["RunFinished"]);
      expect(issues.rebuilds).toEqual([]);
    }
  });

  it("records one ToolDenied per new toolUseId", () => {
    const { events, recorder } = setup();
    const sink = recorder.denialSink(CTX);
    sink.record({ toolName: "Bash", toolUseId: "t1" });
    expect(events.appended).toEqual([
      {
        type: "ToolDenied",
        projectId: "p",
        issueId: 7,
        runId: "r1",
        actor: "daemon",
        at: AT,
        payload: { toolName: "Bash", toolUseId: "t1" },
      },
    ]);
    sink.record({ toolName: "Bash", toolUseId: "t1" });
    expect(events.appended).toHaveLength(1);
    sink.record({ toolName: "Bash", toolUseId: "t2" });
    expect(events.appended).toHaveLength(2);
  });

  it("dedupes tool denials per run, not globally", () => {
    const { events, recorder } = setup();
    recorder.denialSink(CTX).record({ toolName: "Bash", toolUseId: "t1" });
    const sink2 = recorder.denialSink({ runId: "r2", issueId: 7 });
    sink2.record({ toolName: "Bash", toolUseId: "t1" });
    expect(events.appended).toHaveLength(2);
    expect(events.appended[1]?.runId).toBe("r2");
  });

  it("records every denial that has an empty toolUseId", () => {
    const { events, recorder } = setup();
    const sink = recorder.denialSink(CTX);
    sink.record({ toolName: "Bash", toolUseId: "" });
    sink.record({ toolName: "Bash", toolUseId: "" });
    expect(events.appended.map((e) => e.type)).toEqual(["ToolDenied", "ToolDenied"]);
  });

  it("does not mark a denial as seen when the append throws", () => {
    const { events, recorder } = setup();
    const realAppend = events.append.bind(events);
    let failing = true;
    events.append = (event) => {
      if (failing) throw new Error("disk full");
      return realAppend(event);
    };
    const sink = recorder.denialSink(CTX);
    expect(() => sink.record({ toolName: "Bash", toolUseId: "t1" })).toThrow("disk full");
    failing = false;
    sink.record({ toolName: "Bash", toolUseId: "t1" });
    sink.record({ toolName: "Bash", toolUseId: "t1" });
    expect(events.appended.filter((e) => e.type === "ToolDenied")).toHaveLength(1);
  });

  it("is exported by the package index and declares the contracts dependency", () => {
    expect(typeof createRunRecorder).toBe("function");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@friday/contracts"]).toBe("workspace:*");
  });
});
