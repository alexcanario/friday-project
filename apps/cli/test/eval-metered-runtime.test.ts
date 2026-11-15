import { describe, expect, it } from "vitest";
import {
  heldReasonFor,
  type AgentRunOptions,
  type AgentRunRequest,
  type RunRecord,
} from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import { createMeteredRuntime } from "../src/eval-metered-runtime.ts";

const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);
const ISO = new Date(NOW).toISOString();

const agent = (maxBudgetUsd: number): AgentRunOptions => ({
  model: "sonnet",
  states: ["InProgress"],
  maxBudgetUsd,
  maxTurns: 10,
  timeoutMs: 1000,
  tools: ["Read"],
  allowedTools: [],
  bashAllow: [],
  promptFile: "prompts/generic.md",
  outputKind: "workReport",
});

const request = (maxBudgetUsd: number, withFriday = true): AgentRunRequest => ({
  cwd: "/wt",
  prompt: "P",
  configRoot: "/cfg",
  agent: agent(maxBudgetUsd),
  ...(withFriday
    ? {
        friday: {
          runId: "unassigned",
          agent: { states: ["InProgress"], mcp_tools: ["work_report"] },
          getIssueState: () => "InProgress" as const,
        },
      }
    : {}),
});

const finished = (over: Partial<RunFinished> = {}): RunFinished => ({
  status: "succeeded",
  subtype: null,
  model: "sonnet",
  costUsd: 0,
  tokens: null,
  numTurns: 1,
  durationMs: 10,
  output: null,
  violations: [],
  ...over,
});

type Step = RunFinished | Error;

function setup(steps: Step[], budgetUsd = 2) {
  const received: AgentRunRequest[] = [];
  const saved: RunRecord[] = [];
  const savedAtCall: RunRecord[][] = [];
  const ids = ["r1", "r2", "r3", "r4"];
  const metered = createMeteredRuntime({
    runtime: {
      run: async (req) => {
        received.push(req);
        savedAtCall.push([...saved]);
        const next = steps.shift();
        if (next === undefined) throw new Error("sem passo");
        if (next instanceof Error) throw next;
        return next;
      },
    },
    runs: { save: (row) => saved.push({ ...row }) },
    projectId: "p1",
    issue: 12,
    budgetUsd,
    newRunId: () => ids.shift() ?? "rx",
    now: () => NOW,
  });
  return { metered, received, saved, savedAtCall };
}

describe("createMeteredRuntime", () => {
  it("caps each call at min(card, remaining) and holds at zero", async () => {
    const s = setup([
      finished({ costUsd: 0.5, peakContextTokens: 4200 }),
      finished({ costUsd: 1.5, peakContextTokens: 9000 }),
    ]);
    const first = await s.metered.runtime.run(request(1.5));
    expect(s.received[0]!.agent.maxBudgetUsd).toBe(1.5);
    expect(first.costUsd).toBe(0.5);
    expect(first.peakContextTokens).toBe(4200);
    const second = await s.metered.runtime.run(request(3));
    expect(s.received[1]!.agent.maxBudgetUsd).toBe(1.5);
    expect(second.costUsd).toBe(1.5);
    expect(second.peakContextTokens).toBe(9000);
    const rows = s.saved.length;
    const third = await s.metered.runtime.run(request(3));
    expect(s.received).toHaveLength(2);
    expect(s.saved).toHaveLength(rows);
    expect(third).toEqual({
      status: "budget_exceeded",
      subtype: null,
      model: null,
      costUsd: 0,
      tokens: null,
      numTurns: null,
      durationMs: null,
      output: null,
      violations: [],
    });
    expect(heldReasonFor(third)).toBe("BudgetExceeded");
    expect(s.metered.totals()).toEqual({ costUsd: 2, peakContextTokens: 9000 });

    const unknown = setup([finished({ costUsd: null }), finished({ costUsd: 0.1 })]);
    await unknown.metered.runtime.run(request(1.5));
    expect(unknown.metered.totals().costUsd).toBeNull();
    await unknown.metered.runtime.run(request(3));
    expect(unknown.received[1]!.agent.maxBudgetUsd).toBe(0.5);
    expect(unknown.metered.totals()).toEqual({ costUsd: null, peakContextTokens: null });

    const idle = setup([
      finished({ costUsd: 0.25 }),
      finished({ costUsd: 0.25, peakContextTokens: null }),
      finished({ costUsd: 0.25, peakContextTokens: 300 }),
    ]);
    expect(idle.metered.totals()).toEqual({ costUsd: 0, peakContextTokens: null });
    await idle.metered.runtime.run(request(1));
    await idle.metered.runtime.run(request(1));
    expect(idle.metered.totals()).toEqual({ costUsd: 0.5, peakContextTokens: null });
    await idle.metered.runtime.run(request(1));
    expect(idle.metered.totals()).toEqual({ costUsd: 0.75, peakContextTokens: 300 });
  });

  it("saves a running row per call and closes it", async () => {
    const s = setup([
      finished({ costUsd: 0.1 }),
      finished({ status: "failed", costUsd: 0.1 }),
      finished({ status: "budget_exceeded", costUsd: 0.1 }),
      new Error("caiu"),
    ]);
    const running = (id: string): RunRecord => ({
      id,
      projectId: "p1",
      issueId: 12,
      phase: null,
      startedAt: ISO,
      finishedAt: null,
      status: "running",
    });
    await s.metered.runtime.run(request(0.3));
    expect(s.received[0]!.friday?.runId).toBe("r1");
    expect(s.savedAtCall[0]).toEqual([running("r1")]);
    expect(s.saved[1]).toEqual({ ...running("r1"), finishedAt: ISO, status: "succeeded" });
    await s.metered.runtime.run(request(0.3));
    expect(s.received[1]!.friday?.runId).toBe("r2");
    expect(s.saved[3]).toEqual({ ...running("r2"), finishedAt: ISO, status: "failed" });
    await s.metered.runtime.run(request(0.3));
    expect(s.saved[5]).toEqual({ ...running("r3"), finishedAt: ISO, status: "failed" });
    await expect(s.metered.runtime.run(request(0.3))).rejects.toThrow("caiu");
    expect(s.saved[6]).toEqual(running("r4"));
    expect(s.saved[7]).toEqual({ ...running("r4"), finishedAt: ISO, status: "failed" });

    const plain = setup([finished({ costUsd: 0.1 })]);
    await plain.metered.runtime.run(request(1, false));
    expect(plain.received[0]).not.toHaveProperty("friday");
    expect(plain.saved[0]).toEqual(running("r1"));
  });
});
