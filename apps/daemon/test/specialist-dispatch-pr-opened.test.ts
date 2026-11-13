import { describe, expect, it, vi } from "vitest";
import type { AgentRunRequest, DaySum, IssueRow, LedgerRepository } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import {
  buildSpecialistRequest,
  createRunRecorder,
  runSpecialistForIssue,
  type SpecialistDispatchDeps,
} from "../src/index.ts";
import { FakeEvents, FakeIssueRepository, FakeRunRepository } from "./fakes.ts";

const now = () => new Date("2026-11-07T03:00:00.000Z");
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
const report = {
  summary: "Adiciona GET /version",
  headSha: "a".repeat(40),
  changedFiles: ["src/Version.cs"],
  notDone: [],
};
const finished = (output: unknown): RunFinished => ({
  status: "succeeded",
  subtype: null,
  model: null,
  costUsd: null,
  tokens: null,
  numTurns: null,
  durationMs: null,
  output,
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
  calls?: number[];
  throwsAfter?: boolean;
  output?: unknown;
  noEffects?: boolean;
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
  const runs = new FakeRunRepository();
  const original = request("run-1");
  const target = o.noEffects ? ({ ...original, friday: undefined } as AgentRunRequest) : original;
  const runtime = {
    run: (r: AgentRunRequest) => {
      for (const n of o.calls ?? []) r.friday!.effects!.run.onPrCreated!(n);
      if (o.throwsAfter) return Promise.reject(new Error("boom"));
      return Promise.resolve(finished(o.output ?? report));
    },
  };
  const sum = (costUsd: number): DaySum => ({ costUsd, anyCostUnknown: false });
  const ledger: LedgerRepository = {
    record: () => undefined,
    sumByDay: () => sum(0),
    sumByIssue: () => sum(0),
  };
  const recorderDeps = { projectId: "p", events, issues, now };
  const recorder = createRunRecorder(recorderDeps);
  const log = vi.fn<(m: string) => void>();
  const deps: SpecialistDispatchDeps = {
    projectId: "p",
    targetOf: () => target,
    step: { runtime },
    recorder: recorderDeps,
    recording: { runs, recorder, newRunId: () => "run-1" },
    budget: { ledger, recorderDeps },
    caps: { perDayUsd: 100, perIssueUsd: 10 },
    now,
    prHead: () => Promise.reject(new Error("sem PR")),
    worktreeHead: () => Promise.resolve(null),
    isClean: () => Promise.resolve(true),
    log,
  };
  const ofType = (t: string) => events.appended.filter((e) => e.type === t);
  return { events, deps, log, ofType, original };
}

describe("runSpecialistForIssue PrOpened", () => {
  it("records one PrOpened with the pr number when pr_create succeeded", async () => {
    const t = setup({ calls: [42] });
    await runSpecialistForIssue(t.deps, 7);
    const opened = t.ofType("PrOpened");
    expect(opened).toHaveLength(1);
    expect(opened[0]?.payload).toEqual({ number: 42 });
    expect(opened[0]).toMatchObject({
      projectId: "p",
      issueId: 7,
      runId: "run-1",
      actor: "daemon",
      at: "2026-11-07T03:00:00.000Z",
    });
  });

  it("records no PrOpened without a successful pr_create or without effects", async () => {
    const t = setup();
    await runSpecialistForIssue(t.deps, 7);
    expect(t.ofType("PrOpened")).toHaveLength(0);
    expect(t.ofType("WorkReported")).toHaveLength(1);
    const bare = setup({ noEffects: true });
    await expect(runSpecialistForIssue(bare.deps, 7)).resolves.toBeDefined();
    expect(bare.ofType("PrOpened")).toHaveLength(0);
  });

  it("records the last pr number once per run", async () => {
    const t = setup({ calls: [41, 42] });
    await runSpecialistForIssue(t.deps, 7);
    expect(t.ofType("PrOpened")).toHaveLength(1);
    expect(t.ofType("PrOpened")[0]?.payload).toEqual({ number: 42 });
  });

  it("records nothing when the runtime throws and records when the run is held", async () => {
    const thrown = setup({ calls: [42], throwsAfter: true });
    await expect(runSpecialistForIssue(thrown.deps, 7)).resolves.toBeDefined();
    expect(thrown.ofType("PrOpened")).toHaveLength(0);
    const held = setup({ calls: [42], output: { summary: "x" } });
    await runSpecialistForIssue(held.deps, 7);
    expect(held.ofType("PrOpened")).toHaveLength(1);
    expect(held.ofType("PrOpened")[0]?.payload).toEqual({ number: 42 });
  });

  it("keeps PrOpened when applySpecialistOutcome throws", async () => {
    const t = setup({ calls: [42] });
    t.events.failWhen = (e) => (e.type === "StateChanged" ? new Error("disco") : null);
    await expect(runSpecialistForIssue(t.deps, 7)).resolves.toBeDefined();
    expect(t.ofType("PrOpened")).toHaveLength(1);
    expect(t.ofType("PrOpened")[0]?.payload).toEqual({ number: 42 });
    expect(t.ofType("StateChanged")).toHaveLength(0);
  });

  it("logs and does not reject when appending PrOpened fails", async () => {
    const t = setup({ calls: [42] });
    t.events.failWhen = (e) => (e.type === "PrOpened" ? new Error("disco") : null);
    await expect(runSpecialistForIssue(t.deps, 7)).resolves.toBeDefined();
    expect(t.ofType("PrOpened")).toHaveLength(0);
    expect(t.log).toHaveBeenCalledWith(expect.stringContaining("issue 7"));
  });

  it("does not mutate the original request", async () => {
    const t = setup({ calls: [42] });
    await runSpecialistForIssue(t.deps, 7);
    expect(t.original.friday!.effects!.run.onPrCreated).toBeUndefined();
  });
});
