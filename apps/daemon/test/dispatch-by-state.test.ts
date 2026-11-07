import { describe, expect, it, vi } from "vitest";
import { classifyRisk, decideGates, type IssueRow, type PrDiff } from "@friday/application";
import {
  createStateDispatcher,
  createTicker,
  STATE_ROLES,
  type DispatchConfig,
  type DispatchRole,
  type RunRequestBuilder,
  type StateDispatcherDeps,
} from "../src/index.ts";
import {
  FakeClock,
  FakeEvents,
  FakeGitHub,
  FakeIssueRepository,
  PendingRuntime,
  fakeRequest,
} from "./fakes.ts";

const NOW = "2026-11-05T03:00:00.000Z";
const CONFIG: DispatchConfig = {
  risk: {
    rules: ["migrations", "infra", "ci", "dependencies", "secrets", "agent_config", "size"],
    max_changed_lines: 400,
    max_changed_files: 20,
  },
  mergeMode: "manual",
  screenPaths: [],
};
const SIMPLE_DIFF: PrDiff = {
  files: [{ path: "src/a.ts", changedLines: 1, hasPatch: true }],
  diffBytes: 100,
};
const WORKFLOW_DIFF: PrDiff = {
  files: [{ path: ".github/workflows/ci.yml", changedLines: 1, hasPatch: true }],
  diffBytes: 100,
};

const row = (issueId: number, state: string, heldReason: string | null = null): IssueRow => ({
  projectId: "p",
  issueId,
  state,
  heldReason,
  verifyRound: 0,
  qaRound: 0,
  reviewIter: 0,
});

function setup(
  options: {
    states?: Record<number, string>;
    roles?: Partial<Record<DispatchRole, RunRequestBuilder>>;
    config?: DispatchConfig | null;
    pr?: number | null;
    diff?: PrDiff;
    extraLabels?: Record<number, string[]>;
  } = {},
) {
  const order: string[] = [];
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events, order);
  const github = new FakeGitHub(order);
  const states = options.states ?? { 10: "Todo", 11: "InProgress", 12: "InProgress" };
  const labels: Record<number, string[]> = {
    10: ["friday"],
    11: ["friday"],
    12: ["bug"],
    ...options.extraLabels,
  };
  for (const [id, state] of Object.entries(states)) {
    issues.rows.set(Number(id), row(Number(id), state));
    github.issues.push({
      number: Number(id),
      title: `t${id}`,
      body: "",
      labels: labels[Number(id)] ?? ["friday"],
    });
  }
  github.diffs.set(5, options.diff ?? SIMPLE_DIFF);
  const tb = vi.fn<RunRequestBuilder>((id) => fakeRequest(id));
  const sb = vi.fn<RunRequestBuilder>((id) => fakeRequest(id + 1000));
  const log = vi.fn<(m: string) => void>();
  const classify = vi.fn(classifyRisk);
  const decide = vi.fn(decideGates);
  const deps: StateDispatcherDeps = {
    projectId: "p",
    github,
    issues,
    events,
    roles: options.roles ?? { triage: tb, specialist: sb },
    readConfig: () => (options.config === undefined ? CONFIG : options.config),
    prOf: () => (options.pr === undefined ? 5 : options.pr),
    now: () => new Date(NOW),
    log,
    classifyRisk: classify,
    decideGates: decide,
  };
  return {
    deps,
    dispatcher: createStateDispatcher(deps),
    events,
    issues,
    github,
    order,
    tb,
    sb,
    log,
    classify,
    decide,
  };
}

const RISK_STATES = { 10: "Todo", 11: "InProgress", 13: "RiskCheck" };
const RISK_LABELS = { 13: ["friday", "gate:business"] };

describe("state dispatcher", () => {
  it("lists only friday-labeled issues with a role", async () => {
    const t = setup();
    await expect(t.dispatcher.listReady()).resolves.toEqual([10, 11]);
    expect(t.github.listCalls).toEqual(["friday"]);
    expect(t.issues.getCalls).not.toContain(12);
  });

  it("maps each state to its role", async () => {
    expect(STATE_ROLES).toEqual({
      Todo: "triage",
      Triage: "triage",
      InProgress: "specialist",
      Verify: "verify",
      QA: "qa",
      InReview: "judge",
    });
    const t = setup({ states: { 10: "Triage", 11: "InProgress", 12: "InProgress" } });
    await expect(t.dispatcher.listReady()).resolves.toEqual([10, 11]);
  });

  it("skips states without a role or without a registered stage and never throws", async () => {
    const noStage = setup({
      states: { 10: "Verify", 11: "InReview", 12: "Held" },
      extraLabels: { 12: ["friday"] },
    });
    await expect(noStage.dispatcher.listReady()).resolves.toEqual([]);

    const noRoles = setup({ roles: {} });
    await expect(noRoles.dispatcher.listReady()).resolves.toEqual([]);

    const missingRow = setup();
    missingRow.issues.rows.delete(10);
    await expect(missingRow.dispatcher.listReady()).resolves.toEqual([11]);

    const badState = setup({ states: { 10: "Bogus", 11: "InProgress", 12: "InProgress" } });
    await expect(badState.dispatcher.listReady()).resolves.toEqual([11]);
    expect(badState.log).toHaveBeenCalledTimes(1);

    const badHeld = setup();
    badHeld.issues.rows.set(10, row(10, "Todo", "Bogus"));
    await expect(badHeld.dispatcher.listReady()).resolves.toEqual([11]);
    expect(badHeld.log).toHaveBeenCalledTimes(1);
  });

  it("builds the request with the role of the state", async () => {
    const t = setup();
    await t.dispatcher.listReady();
    expect(t.dispatcher.buildRequest(10)).toEqual(fakeRequest(10));
    expect(t.tb).toHaveBeenCalledWith(10);
    t.dispatcher.buildRequest(11);
    expect(t.sb).toHaveBeenCalledWith(11);
    expect(() => t.dispatcher.buildRequest(99)).toThrow("A issue 99 não foi despachada por estado");
  });

  it("handles RiskCheck with one classifyRisk, one decideGates, one RiskAssessed event and the gate labels", async () => {
    const t = setup({ states: RISK_STATES, extraLabels: RISK_LABELS });
    const ready = await t.dispatcher.listReady();
    expect(ready).toEqual([10, 11]);
    expect(t.classify).toHaveBeenCalledTimes(1);
    expect(t.classify).toHaveBeenCalledWith(SIMPLE_DIFF, CONFIG.risk);
    expect(t.decide).toHaveBeenCalledTimes(1);
    expect(t.decide).toHaveBeenCalledWith({
      risk: "unclassified",
      mergeMode: "manual",
      changedPaths: ["src/a.ts"],
      screenPaths: [],
      issueGates: ["gate:business"],
    });
    expect(t.events.appended).toEqual([
      {
        type: "StateChanged",
        projectId: "p",
        issueId: 13,
        runId: null,
        actor: "daemon",
        at: NOW,
        payload: {
          type: "StateChanged",
          issueId: "13",
          from: "RiskCheck",
          to: "AwaitingApproval",
          trigger: "RiskAssessed",
          heldReason: null,
          verifyRound: 0,
          qaRound: 0,
          reviewIter: 0,
        },
      },
    ]);
    expect(t.issues.rebuilds).toEqual([{ projectId: "p", appendedCount: 1 }]);
    expect(t.github.labelCalls).toEqual([{ issue: 13, label: "gate:business" }]);
    expect(t.order).toEqual(["rebuild", "addLabel"]);
  });

  it("passes the high risk and labels the security gate for workflow paths", async () => {
    const t = setup({ states: RISK_STATES, extraLabels: RISK_LABELS, diff: WORKFLOW_DIFF });
    await t.dispatcher.listReady();
    expect(t.decide).toHaveBeenCalledWith(
      expect.objectContaining({ risk: "high", changedPaths: [".github/workflows/ci.yml"] }),
    );
    expect(t.events.appended).toHaveLength(1);
    expect(t.events.appended[0]?.payload).toMatchObject({ to: "AwaitingApproval" });
    expect(t.github.labelCalls).toEqual([
      { issue: 13, label: "gate:business" },
      { issue: 13, label: "gate:security" },
    ]);
  });

  it("records nothing when the PR, the diff or the config is missing", async () => {
    const cases: Array<Parameters<typeof setup>[0] & { noDiff?: boolean }> = [
      { pr: null },
      { noDiff: true },
      { config: null },
    ];
    for (const c of cases) {
      const t = setup({ states: RISK_STATES, extraLabels: RISK_LABELS, ...c });
      if (c.noDiff) t.github.diffs.clear();
      await expect(t.dispatcher.listReady()).resolves.toEqual([10, 11]);
      expect(t.events.appended).toHaveLength(0);
      expect(t.issues.rebuilds).toHaveLength(0);
      expect(t.github.labelCalls).toHaveLength(0);
      expect(t.log).toHaveBeenCalledTimes(1);
    }
    const done = setup({ states: { ...RISK_STATES, 13: "AwaitingApproval" } });
    await done.dispatcher.listReady();
    expect(done.classify).not.toHaveBeenCalled();
    expect(done.decide).not.toHaveBeenCalled();
    expect(done.github.labelCalls).toHaveLength(0);
  });

  it("keeps the event and logs when addLabel fails", async () => {
    const t = setup({ states: RISK_STATES, extraLabels: RISK_LABELS, diff: WORKFLOW_DIFF });
    t.github.addLabelFailure = new Error("boom");
    await expect(t.dispatcher.listReady()).resolves.toEqual([10, 11]);
    expect(t.events.appended).toHaveLength(1);
    expect(t.github.labelCalls).toHaveLength(2);
    expect(t.log).toHaveBeenCalledTimes(2);
  });

  it("runs RiskCheck without AgentRuntime inside the ticker and stays idle when disabled", async () => {
    const t = setup({ states: RISK_STATES, extraLabels: RISK_LABELS });
    const runtime = new PendingRuntime();
    const make = (enabled: boolean) =>
      createTicker({
        projectId: "p",
        clock: new FakeClock(),
        readConfig: () => ({ enabled, maxConcurrentRuns: 3, perIssueUsd: 5, perDayUsd: 10 }),
        issues: t.dispatcher,
        buildRequest: t.dispatcher.buildRequest,
        runtime,
        events: t.events,
      });
    const off = make(false);
    await off.tick();
    expect(t.github.listCalls).toHaveLength(0);
    expect(t.events.appended).toHaveLength(0);

    const ticker = make(true);
    await ticker.tick();
    expect(runtime.requests).toHaveLength(2);
    runtime.resolveAll({} as never);
    await ticker.idle();
    expect(
      t.events.appended.filter((e) => e.type === "StateChanged" && e.issueId === 13),
    ).toHaveLength(1);
  });

  it("is exported by the package index", () => {
    expect(typeof createStateDispatcher).toBe("function");
  });
});
