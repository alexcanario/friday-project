import { describe, expect, it, vi } from "vitest";
import {
  FakeAgentRuntime,
  type AgentRunRequest,
  type DaySum,
  type IssueRow,
  type LedgerRepository,
} from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import {
  buildSpecialistRequest,
  createRunRecorder,
  runSpecialistForIssue,
  type SpecialistDispatchDeps,
} from "../src/index.ts";
import { FakeEvents, FakeIssueRepository, FakeRunRepository } from "./fakes.ts";

const now = () => new Date("2026-11-13T03:00:00.000Z");
const D = "d".repeat(40);
const E = "e".repeat(40);
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

const finished = (headSha: string): RunFinished => ({
  status: "succeeded",
  subtype: null,
  model: null,
  costUsd: 0.1,
  tokens: null,
  numTurns: null,
  durationMs: null,
  output: { summary: "Pronto", headSha, changedFiles: ["a.ts"], notDone: [] },
  violations: [],
});

const request = (runId: string): AgentRunRequest =>
  buildSpecialistRequest({
    issue: { number: 7, title: "Adiciona GET /version", body: "Corpo" },
    criteria: null,
    feedback: null,
    agent,
    friday: {
      runId,
      agent: { states: ["InProgress"], mcp_tools: ["work_report"] },
      getIssueState: () => "InProgress",
    },
    cwd: "/tmp/wt",
    configRoot: "/cfg",
    branch: "friday/7-version",
    base: "develop",
    getPullRequest: () => null,
  });

/** Issue 7 has PR 22 at `D` while its worktree is at `E`; `aligned` is what `align` answers. */
function setup(aligned: boolean) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events, undefined, { projectFromEvents: true });
  const row: IssueRow = {
    projectId: "p",
    issueId: 7,
    state: "InProgress",
    heldReason: null,
    verifyRound: 0,
    qaRound: 0,
    reviewIter: 0,
  };
  issues.rows.set(7, row);
  events.append({
    projectId: "p",
    issueId: 7,
    runId: "run-0",
    type: "PrOpened",
    payload: { number: 22 },
    actor: "daemon",
    at: now().toISOString(),
  });
  const runs = new FakeRunRepository();
  const runtime = new FakeAgentRuntime([finished(D)]);
  const sum = (costUsd: number): DaySum => ({ costUsd, anyCostUnknown: false });
  const record = vi.fn();
  const ledger: LedgerRepository = {
    record,
    sumByDay: () => sum(0),
    sumByIssue: () => sum(0),
  };
  const recorderDeps = { projectId: "p", events, issues, now };
  const recorder = createRunRecorder(recorderDeps);
  const runsBeforeAlign: number[] = [];
  const align = vi.fn((_path: string, _sha: string) => {
    runsBeforeAlign.push(runtime.requests.length);
    return Promise.resolve(aligned);
  });
  const deps: SpecialistDispatchDeps = {
    projectId: "p",
    targetOf: (_id, runId) => request(runId),
    step: { runtime },
    recorder: recorderDeps,
    recording: { runs, recorder, newRunId: () => "run-1" },
    budget: { ledger, recorderDeps },
    caps: { perDayUsd: 100, perIssueUsd: 10 },
    now,
    prHead: () => Promise.resolve(D),
    worktreeHead: () => Promise.resolve(E),
    isClean: () => Promise.resolve(true),
    align,
  };
  const ofType = (t: string) => events.appended.filter((e) => e.type === t);
  return { deps, runtime, runs, record, issues, ofType, align, runsBeforeAlign };
}

describe("runSpecialistForIssue com worktree defasado", () => {
  it("worktree defasado é alinhado antes da run", async () => {
    const t = setup(true);
    await runSpecialistForIssue(t.deps, 7);
    expect(t.align).toHaveBeenCalledWith("/tmp/wt", D);
    expect(t.runsBeforeAlign).toEqual([0]);
    expect(t.runtime.requests).toHaveLength(1);
    expect(t.runtime.requests[0]?.headFallback).toBe(D);
    expect(t.issues.rows.get(7)?.state).not.toBe("Held");
  });

  it("falha do alinhamento retém com RuntimeFailed sem rodar o agente", async () => {
    const t = setup(false);
    await runSpecialistForIssue(t.deps, 7);
    expect(t.align).toHaveBeenCalledWith("/tmp/wt", D);
    expect(t.runtime.requests).toHaveLength(0);
    expect(t.runs.rows.size).toBe(0);
    expect(t.record).not.toHaveBeenCalled();
    expect(t.issues.rows.get(7)).toMatchObject({ state: "Held", heldReason: "RuntimeFailed" });
    expect(t.ofType("StateChanged")).toHaveLength(1);
  });
});
