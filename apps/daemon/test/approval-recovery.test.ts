import { describe, expect, it, vi } from "vitest";
import type { IssueRow, PrDiff, StateChangedPayload } from "@friday/application";
import type { Risk } from "@friday/domain";
import { createStateDispatcher, type ApprovalDeps, type DispatchConfig } from "../src/index.ts";
import { FakeApprovalStore, FakeEvents, FakeGitHub, FakeIssueRepository } from "./fakes.ts";

const T0 = Date.parse("2026-11-06T03:00:00.000Z");
const A = "a".repeat(40);
const CONFIG: DispatchConfig = {
  risk: {
    rules: ["migrations", "infra", "ci", "dependencies", "secrets", "agent_config", "size"],
    max_changed_lines: 400,
    max_changed_files: 20,
  },
  mergeMode: "manual",
  screenPaths: [],
};
const DIFF: PrDiff = {
  files: [{ path: "src/a.ts", changedLines: 1, hasPatch: true }],
  diffBytes: 100,
};

type Options = {
  state?: string;
  pr?: number | null;
  risk?: Risk;
  config?: DispatchConfig | null;
};

function setup(options: Options = {}) {
  const events = new FakeEvents([]);
  const issues = new FakeIssueRepository(events, undefined, { projectFromEvents: true });
  const row: IssueRow = {
    projectId: "p",
    issueId: 13,
    state: options.state ?? "AwaitingApproval",
    heldReason: null,
    verifyRound: 0,
    qaRound: 0,
    reviewIter: 0,
  };
  issues.rows.set(13, row);
  const github = new FakeGitHub();
  github.issues.push({ number: 13, title: "t", body: "", labels: ["friday"] });
  github.diffs.set(5, DIFF);
  const store = new FakeApprovalStore();
  const headOf = vi.fn<(pr: number) => Promise<string>>(() => Promise.resolve(A));
  const approval: ApprovalDeps = {
    store,
    unitOfWork: { run: (work) => work() },
    headOf,
    prMergeStateOf: () => Promise.resolve({ merged: true, headSha: A }),
    newId: () => "0a1b2c3d",
  };
  const log = vi.fn<(m: string) => void>();
  const ctl = {
    config: options.config === undefined ? CONFIG : options.config,
    pr: options.pr === undefined ? 5 : options.pr,
  };
  const classifyRisk = vi.fn(() => ({ risk: options.risk ?? ("unclassified" as Risk), rules: [] }));
  const dispatcher = createStateDispatcher({
    projectId: "p",
    github,
    issues,
    events,
    roles: {},
    readConfig: () => ctl.config,
    prOf: () => ctl.pr,
    now: () => new Date(T0),
    log,
    classifyRisk,
    approval,
  });
  const changes = () =>
    events
      .list("p", 13)
      .filter((e) => e.type === "StateChanged")
      .map((e) => e.payload as StateChangedPayload);
  const requested = () => events.list("p", 13).filter((e) => e.type === "ApprovalRequested");
  return { dispatcher, github, issues, store, headOf, log, ctl, changes, requested, classifyRisk };
}

const pending = (t: ReturnType<typeof setup>) => ({
  id: "x",
  projectId: "p",
  issueId: 13,
  pr: 5,
  headSha: A,
  tier: "high" as Risk,
  requestedAt: T0,
  expiresAt: T0 + 1_800_000,
  decision: null,
  decidedAt: null,
  decidedBy: null,
  ...(t ? {} : {}),
});

describe("approval recovery", () => {
  it("recreates a missing approval request with the reclassified tier", async () => {
    const t = setup();
    await t.dispatcher.listReady();
    expect([...t.store.records.values()]).toEqual([
      expect.objectContaining({
        pr: 5,
        headSha: A,
        tier: "unclassified",
        decision: null,
        expiresAt: T0 + 1_800_000,
      }),
    ]);
    expect(t.requested()).toHaveLength(1);
    expect(t.issues.rows.get(13)?.state).toBe("AwaitingApproval");
  });

  it("recovers the request after the first insert fails, with tier high", async () => {
    const t = setup({ state: "RiskCheck", risk: "high" });
    const insert = vi.spyOn(t.store, "insert").mockImplementationOnce(() => {
      throw new Error("disco cheio");
    });
    await t.dispatcher.listReady();
    expect(t.issues.rows.get(13)?.state).toBe("AwaitingApproval");
    expect(t.store.records.size).toBe(0);
    expect(t.log).toHaveBeenCalledWith(expect.stringContaining("13"));
    await t.dispatcher.listReady();
    expect(insert).toHaveBeenCalledTimes(2);
    expect([...t.store.records.values()]).toEqual([expect.objectContaining({ tier: "high" })]);
    expect(t.requested()).toHaveLength(1);
    expect(t.headOf.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("does not record a request while the tier is unavailable", async () => {
    const t = setup({ risk: "high" });
    t.github.getPrDiff = vi.fn().mockRejectedValueOnce(new Error("sem rede"));
    await expect(t.dispatcher.listReady()).resolves.toBeDefined();
    expect(t.store.records.size).toBe(0);
    expect(t.log).toHaveBeenCalledWith(expect.stringContaining("13"));
    t.ctl.config = null;
    t.log.mockClear();
    await expect(t.dispatcher.listReady()).resolves.toBeDefined();
    expect(t.store.records.size).toBe(0);
    expect(t.log).toHaveBeenCalledWith(expect.stringContaining("13"));
    t.ctl.config = CONFIG;
    t.github.getPrDiff = () => Promise.resolve(DIFF);
    await t.dispatcher.listReady();
    expect([...t.store.records.values()]).toEqual([expect.objectContaining({ tier: "high" })]);
  });

  it("never defaults the tier to low when the config is missing", async () => {
    const t = setup({ risk: "high", config: null });
    await t.dispatcher.listReady();
    expect(t.store.records.size).toBe(0);
    expect(t.log).toHaveBeenCalledWith(expect.stringContaining("13"));
    t.ctl.config = CONFIG;
    await t.dispatcher.listReady();
    expect([...t.store.records.values()]).toEqual([expect.objectContaining({ tier: "high" })]);
  });

  it("does not recreate a request when one is pending", async () => {
    const t = setup();
    t.store.seed(pending(t));
    const getPrDiff = vi.spyOn(t.github, "getPrDiff");
    await t.dispatcher.listReady();
    expect(t.headOf).not.toHaveBeenCalled();
    expect(getPrDiff).not.toHaveBeenCalled();
    expect(t.classifyRisk).not.toHaveBeenCalled();
    expect(t.store.records.size).toBe(1);
  });

  it("keeps holding a denied request without creating a new one", async () => {
    const t = setup();
    t.store.seed({ ...pending(t), decision: "denied", decidedAt: T0 + 1, decidedBy: "alex" });
    await t.dispatcher.listReady();
    expect(t.store.records.size).toBe(1);
    expect(t.issues.rows.get(13)).toMatchObject({ state: "Held", heldReason: "ApprovalDenied" });
  });

  it("holds an AwaitingApproval issue that has no PR as ApprovalExpired", async () => {
    const t = setup({ pr: null });
    const getPrDiff = vi.spyOn(t.github, "getPrDiff");
    await t.dispatcher.listReady();
    expect(t.headOf).not.toHaveBeenCalled();
    expect(getPrDiff).not.toHaveBeenCalled();
    expect(t.store.records.size).toBe(0);
    expect(t.changes().filter((c) => c.trigger === "ApprovalExpired")).toHaveLength(1);
    expect(t.issues.rows.get(13)).toMatchObject({ state: "Held", heldReason: "ApprovalExpired" });
  });

  it("retries on the next tick when headOf rejects", async () => {
    const t = setup({ risk: "high" });
    t.headOf.mockRejectedValueOnce(new Error("sem rede"));
    await expect(t.dispatcher.listReady()).resolves.toBeDefined();
    expect(t.store.records.size).toBe(0);
    expect(t.log).toHaveBeenCalledWith(expect.stringContaining("13"));
    await t.dispatcher.listReady();
    expect(t.store.records.size).toBe(1);
  });
});
