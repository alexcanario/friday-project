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

type Opts = {
  withPr?: boolean;
  prHead?: () => Promise<string>;
  worktreeHead?: string | null;
  clean?: boolean;
};

function setup(o: Opts = {}) {
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
  if (o.withPr !== false) {
    events.append({
      projectId: "p",
      issueId: 7,
      runId: "run-0",
      type: "PrOpened",
      payload: { number: 22 },
      actor: "daemon",
      at: now().toISOString(),
    });
  }
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
  const prHead = vi.fn(o.prHead ?? (() => Promise.resolve(D)));
  const worktreeHead = vi.fn(() =>
    Promise.resolve(o.worktreeHead === undefined ? D : o.worktreeHead),
  );
  const isClean = vi.fn(() => Promise.resolve(o.clean ?? true));
  const align = vi.fn(() => Promise.resolve(false));
  const deps: SpecialistDispatchDeps = {
    projectId: "p",
    targetOf: (_id, runId) => request(runId),
    step: { runtime },
    recorder: recorderDeps,
    recording: { runs, recorder, newRunId: () => "run-1" },
    budget: { ledger, recorderDeps },
    caps: { perDayUsd: 100, perIssueUsd: 10 },
    now,
    prHead,
    worktreeHead,
    isClean,
    align,
  };
  const ofType = (t: string) => events.appended.filter((e) => e.type === t);
  return { deps, runtime, runs, record, issues, ofType, prHead, worktreeHead, isClean };
}

describe("runSpecialistForIssue sem push", () => {
  it("sem push relata o head do PR e grava WorkReported", async () => {
    const t = setup();
    await runSpecialistForIssue(t.deps, 7);
    expect(t.prHead).toHaveBeenCalledWith(22);
    expect(t.runtime.requests[0]?.headFallback).toBe(D);
    expect(t.runs.rows.get("run-1")).toMatchObject({ status: "succeeded" });
    const reported = t.ofType("WorkReported");
    expect(reported).toHaveLength(1);
    expect((reported[0]?.payload as { headSha: string }).headSha).toBe(D);
    expect(t.isClean).toHaveBeenCalledWith("/tmp/wt", D);
    expect(t.ofType("StateChanged").every((e) => !JSON.stringify(e).includes("Held"))).toBe(true);
    expect(t.issues.rows.get(7)?.state).not.toBe("Held");
  });

  it.each([
    ["worktree defasado", { worktreeHead: E }],
    ["worktree sem item", { worktreeHead: null }],
    ["prHead rejeitando", { prHead: () => Promise.reject(new Error("rede")) }],
  ] as [string, Opts][])(
    "worktree defasado ou head ilegível retém com RuntimeFailed sem rodar o agente (%s)",
    async (_name, opts) => {
      const t = setup(opts);
      await runSpecialistForIssue(t.deps, 7);
      expect(t.runtime.requests).toHaveLength(0);
      expect(t.runs.rows.size).toBe(0);
      expect(t.record).not.toHaveBeenCalled();
      expect(t.issues.rows.get(7)).toMatchObject({ state: "Held", heldReason: "RuntimeFailed" });
      const changed = t.ofType("StateChanged");
      expect(changed).toHaveLength(1);
      expect(changed[0]?.runId).toBeNull();
    },
  );

  it("edição sem push retém com SchemaInvalid", async () => {
    const t = setup({ clean: false });
    await runSpecialistForIssue(t.deps, 7);
    expect(t.ofType("WorkReported")).toHaveLength(0);
    expect(t.issues.rows.get(7)).toMatchObject({ state: "Held", heldReason: "SchemaInvalid" });
    expect(t.runs.rows.get("run-1")).toMatchObject({ status: "failed" });
  });

  it("sem PR o fallback é null e não lê o head", async () => {
    const t = setup({ withPr: false });
    await runSpecialistForIssue(t.deps, 7);
    expect(t.prHead).not.toHaveBeenCalled();
    expect(t.runtime.requests[0]?.headFallback ?? null).toBeNull();
  });
});
