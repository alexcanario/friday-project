import { describe, expect, it, vi } from "vitest";
import {
  decideGates,
  PrDiffTruncatedError,
  type IssueRow,
  type PrDiff,
  type StateChangedPayload,
} from "@friday/application";
import type { ApprovalDeps, DispatchConfig } from "../src/index.ts";
import { approvalContext, createHandlerEnv, handleRiskCheck } from "../src/state-handlers.ts";
import { handleAwaitingApproval } from "../src/approval-wiring.ts";
import { FakeApprovalStore, FakeEvents, FakeGitHub, FakeIssueRepository } from "./fakes.ts";

const T0 = Date.parse("2026-11-06T03:00:00.000Z");
const HEAD = "a".repeat(40);
const CONFIG: DispatchConfig = {
  risk: {
    rules: ["migrations", "infra", "ci", "dependencies", "secrets", "agent_config", "size"],
    max_changed_lines: 400,
    max_changed_files: 20,
  },
  mergeMode: "auto",
  screenPaths: ["apps/web/**"],
};
const SMALL_DIFF: PrDiff = {
  files: [{ path: "src/a.ts", changedLines: 1, hasPatch: true }],
  diffBytes: 100,
};

const row = (state: string): IssueRow => ({
  projectId: "p",
  issueId: 13,
  state,
  heldReason: null,
  verifyRound: 0,
  qaRound: 0,
  reviewIter: 0,
});

type Options = { state?: string; failure?: Error | null; withApproval?: boolean };

function setup(options: Options = {}) {
  const events = new FakeEvents([]);
  const issues = new FakeIssueRepository(events, undefined, { projectFromEvents: true });
  issues.rows.set(13, row(options.state ?? "RiskCheck"));
  const github = new FakeGitHub();
  if (options.failure !== null) {
    github.diffFailures.set(5, options.failure ?? new PrDiffTruncatedError(3001, 3000));
  } else {
    github.diffs.set(5, SMALL_DIFF);
  }
  const store = new FakeApprovalStore();
  const approval: ApprovalDeps = {
    store,
    unitOfWork: { run: (work) => work() },
    headOf: () => Promise.resolve(HEAD),
    prMergeStateOf: () => Promise.resolve({ merged: false, headSha: HEAD }),
    newId: () => "0a1b2c3d",
  };
  const log = vi.fn<(message: string) => void>();
  const classify = vi.fn(() => ({ risk: "low" as const, rules: [] }));
  const decide = vi.fn(decideGates);
  const env = createHandlerEnv({
    projectId: "p",
    github,
    issues,
    events,
    roles: {},
    readConfig: () => CONFIG,
    prOf: () => 5,
    now: () => new Date(T0),
    log,
    classifyRisk: classify,
    decideGates: decide,
    ...(options.withApproval === true ? { approval } : {}),
  });
  const labels = ["friday", "gate:business"];
  const changes = () =>
    events.appended
      .filter((e) => e.type === "StateChanged")
      .map((e) => e.payload as StateChangedPayload);
  return { env, github, events, store, approval, log, classify, decide, labels, changes };
}

describe("RiskCheck with a truncated PR diff", () => {
  it("does not throw and skips classify when the diff exceeds 3000 files", async () => {
    const t = setup();
    await expect(handleRiskCheck(t.env, 13, t.labels)).resolves.toBeUndefined();
    expect(t.classify).not.toHaveBeenCalled();
  });

  it("decides gates with high risk and no changed paths", async () => {
    const t = setup();
    await handleRiskCheck(t.env, 13, t.labels);
    expect(t.decide).toHaveBeenCalledTimes(1);
    expect(t.decide).toHaveBeenCalledWith({
      risk: "high",
      mergeMode: "auto",
      changedPaths: [],
      screenPaths: CONFIG.screenPaths,
      issueGates: ["gate:business"],
    });
  });

  it("moves to AwaitingApproval even with mergeMode auto", async () => {
    const t = setup();
    await handleRiskCheck(t.env, 13, t.labels);
    expect(t.changes()).toHaveLength(1);
    expect(t.changes()[0]).toMatchObject({
      from: "RiskCheck",
      to: "AwaitingApproval",
      trigger: "RiskAssessed",
    });
  });

  it("applies only the issue gate labels", async () => {
    const t = setup();
    await handleRiskCheck(t.env, 13, t.labels);
    expect(t.github.labelCalls).toEqual([{ issue: 13, label: "gate:business" }]);
  });

  it("logs a pt-BR diagnostic with the count and the issue", async () => {
    const t = setup();
    await handleRiskCheck(t.env, 13, t.labels);
    expect(t.log).toHaveBeenCalledWith(expect.stringMatching(/(?=.*3001)(?=.*\b13\b)/));
  });

  it("records the approval request with tier high", async () => {
    const t = setup({ withApproval: true });
    await handleRiskCheck(t.env, 13, t.labels);
    expect(t.store.latestForIssue("p", 13)).toMatchObject({ issueId: 13, pr: 5, tier: "high" });
  });

  it("recreates a lost approval request with tier high", async () => {
    const t = setup({ state: "AwaitingApproval", withApproval: true });
    await handleAwaitingApproval(approvalContext(t.env, t.approval), 13);
    expect(t.store.latestForIssue("p", 13)).toMatchObject({ issueId: 13, tier: "high" });
  });

  it("keeps current behavior when the diff is complete", async () => {
    const t = setup({ failure: null });
    await handleRiskCheck(t.env, 13, t.labels);
    expect(t.classify).toHaveBeenCalledTimes(1);
    expect(t.classify).toHaveBeenCalledWith(SMALL_DIFF, CONFIG.risk);
    expect(t.decide).toHaveBeenCalledWith(
      expect.objectContaining({ risk: "low", changedPaths: ["src/a.ts"] }),
    );
  });

  it("rethrows non-truncation errors", async () => {
    const t = setup({ failure: new Error("sem rede") });
    await expect(handleRiskCheck(t.env, 13, t.labels)).rejects.toThrow("sem rede");
    expect(t.events.appended).toEqual([]);
  });
});
