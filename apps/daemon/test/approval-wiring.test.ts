import { describe, expect, it, vi } from "vitest";
import type { ApprovalRecord, IssueRow, PrDiff, StateChangedPayload } from "@friday/application";
import { createStateDispatcher, type ApprovalDeps, type DispatchConfig } from "../src/index.ts";
import { FakeApprovalStore, FakeEvents, FakeGitHub, FakeIssueRepository } from "./fakes.ts";

const T0 = Date.parse("2026-11-06T03:00:00.000Z");
const A = "a".repeat(40);
const B = "b".repeat(40);
const CONFIG: DispatchConfig = {
  risk: {
    rules: ["migrations", "infra", "ci", "dependencies", "secrets", "agent_config", "size"],
    max_changed_lines: 400,
    max_changed_files: 20,
  },
  mergeMode: "manual",
  screenPaths: [],
};
const CI_DIFF: PrDiff = {
  files: [{ path: ".github/workflows/ci.yml", changedLines: 1, hasPatch: true }],
  diffBytes: 100,
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

const record = (over: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
  id: "0a1b2c3d",
  projectId: "p",
  issueId: 13,
  pr: 5,
  headSha: A,
  tier: "high",
  requestedAt: T0,
  expiresAt: T0 + 1_800_000,
  decision: null,
  decidedAt: null,
  decidedBy: null,
  ...over,
});

type Options = {
  state?: string;
  withApproval?: boolean;
  config?: DispatchConfig;
  diff?: PrDiff;
  low?: boolean;
};

function setup(options: Options = {}) {
  const order: string[] = [];
  const events = new FakeEvents(order);
  const issues = new FakeIssueRepository(events, undefined, { projectFromEvents: true });
  issues.rows.set(13, row(options.state ?? "RiskCheck"));
  const github = new FakeGitHub();
  github.issues.push({ number: 13, title: "t", body: "", labels: ["friday"] });
  github.diffs.set(5, options.diff ?? CI_DIFF);
  const store = new FakeApprovalStore();
  const clock = { ms: T0 };
  const headOf = vi.fn<(pr: number) => Promise<string>>(() => {
    order.push("headOf");
    return Promise.resolve(A);
  });
  const prMergeStateOf = vi.fn<(pr: number) => Promise<{ merged: boolean; headSha: string }>>(() =>
    Promise.resolve({ merged: true, headSha: A }),
  );
  const approval: ApprovalDeps = {
    store,
    unitOfWork: { run: (work) => work() },
    headOf,
    prMergeStateOf,
    newId: () => "0a1b2c3d",
  };
  const log = vi.fn<(m: string) => void>();
  const dispatcher = createStateDispatcher({
    projectId: "p",
    github,
    issues,
    events,
    roles: {},
    readConfig: () => options.config ?? CONFIG,
    prOf: () => 5,
    now: () => new Date(clock.ms),
    log,
    classifyRisk: () =>
      options.low ? { risk: "low", rules: [] } : { risk: "high", rules: ["ci"] },
    ...(options.withApproval === false ? {} : { approval }),
  });
  const changes = () =>
    events
      .list("p", 13)
      .filter((e) => e.type === "StateChanged")
      .map((e) => e.payload as StateChangedPayload);
  return {
    dispatcher,
    github,
    events,
    issues,
    store,
    clock,
    headOf,
    prMergeStateOf,
    log,
    changes,
    order,
  };
}

describe("approval wiring", () => {
  it("requests approval when RiskAssessed leads to AwaitingApproval", async () => {
    const t = setup();
    await t.dispatcher.listReady();
    expect(t.store.latestForIssue("p", 13)).toEqual(record());
    const types = t.events.list("p", 13).map((e) => e.type);
    expect(types).toEqual(["StateChanged", "ApprovalRequested"]);
    expect(t.changes()[0]).toMatchObject({ trigger: "RiskAssessed", to: "AwaitingApproval" });
    expect(t.headOf).toHaveBeenCalledTimes(1);
    expect(t.headOf).toHaveBeenCalledWith(5);
    expect(t.order.indexOf("headOf")).toBeLessThan(t.order.indexOf("events.append"));
  });

  it("does not request approval for Merging, without the dep or when headOf fails", async () => {
    const auto = setup({
      config: { ...CONFIG, mergeMode: "auto" },
      diff: SMALL_DIFF,
      low: true,
    });
    await auto.dispatcher.listReady();
    expect(auto.issues.rows.get(13)?.state).toBe("Merging");
    expect(auto.store.records.size).toBe(0);
    expect(auto.events.list("p", 13).some((e) => e.type === "ApprovalRequested")).toBe(false);
    expect(auto.headOf).not.toHaveBeenCalled();

    const without = setup({ withApproval: false });
    await expect(without.dispatcher.listReady()).resolves.toEqual([]);
    expect(without.issues.rows.get(13)?.state).toBe("AwaitingApproval");
    expect(without.store.records.size).toBe(0);

    const failing = setup();
    failing.headOf.mockRejectedValueOnce(new Error("sem rede"));
    await expect(failing.dispatcher.listReady()).resolves.toEqual([]);
    expect(failing.issues.rows.get(13)?.state).toBe("RiskCheck");
    expect(failing.store.records.size).toBe(0);
    expect(failing.log).toHaveBeenCalledWith("Falha ao despachar a issue 13: sem rede");
    await failing.dispatcher.listReady();
    expect(failing.issues.rows.get(13)?.state).toBe("AwaitingApproval");
    expect(failing.store.records.size).toBe(1);
  });

  it("expires a pending approval exactly at expiresAt", async () => {
    const t = setup({ state: "AwaitingApproval" });
    t.store.seed(record());
    t.clock.ms = T0 + 1_799_999;
    await t.dispatcher.listReady();
    expect(t.events.list("p", 13)).toHaveLength(0);
    expect(t.issues.rows.get(13)?.state).toBe("AwaitingApproval");
    t.clock.ms = T0 + 1_800_000;
    await t.dispatcher.listReady();
    expect(t.changes()).toHaveLength(1);
    expect(t.changes()[0]).toMatchObject({
      trigger: "ApprovalExpired",
      to: "Held",
      heldReason: "ApprovalExpired",
    });
    expect(t.events.list("p", 13)[0]?.actor).toBe("daemon");
    await t.dispatcher.listReady();
    expect(t.changes()).toHaveLength(1);
    expect(t.prMergeStateOf).not.toHaveBeenCalled();
  });

  it("applies a stored denial once", async () => {
    const t = setup({ state: "AwaitingApproval" });
    t.store.seed(record({ decision: "denied", decidedAt: T0 + 1000, decidedBy: "human:cli" }));
    await t.dispatcher.listReady();
    expect(t.changes()).toHaveLength(1);
    expect(t.changes()[0]).toMatchObject({
      trigger: "ApprovalDenied",
      heldReason: "ApprovalDenied",
    });
    expect(t.issues.rows.get(13)?.state).toBe("Held");
    await t.dispatcher.listReady();
    expect(t.changes()).toHaveLength(1);
  });

  const approved = () =>
    record({ decision: "approved", decidedAt: T0 + 60_000, decidedBy: "human:cli" });

  it("reconciles an approved request whose PR was merged at the approved sha", async () => {
    const t = setup({ state: "AwaitingApproval" });
    t.store.seed(approved());
    t.clock.ms = T0 + 120_000;
    await t.dispatcher.listReady();
    expect(t.changes().map((c) => [c.trigger, c.to])).toEqual([
      ["ApprovalGranted", "Merging"],
      ["Merged", "Done"],
    ]);
    expect(t.events.list("p", 13).every((e) => e.actor === "daemon")).toBe(true);
    expect(t.prMergeStateOf).toHaveBeenCalledTimes(1);
    expect(t.prMergeStateOf).toHaveBeenCalledWith(5);
    await t.dispatcher.listReady();
    expect(t.changes()).toHaveLength(2);
    expect(t.prMergeStateOf).toHaveBeenCalledTimes(1);
  });

  it("blocks the merge when the PR is not merged at the approved sha and retries when the lookup fails", async () => {
    for (const state of [
      { merged: false, headSha: A },
      { merged: true, headSha: B },
    ]) {
      const t = setup({ state: "AwaitingApproval" });
      t.store.seed(approved());
      t.clock.ms = T0 + 120_000;
      t.prMergeStateOf.mockResolvedValue(state);
      await t.dispatcher.listReady();
      expect(t.changes().map((c) => [c.trigger, c.to])).toEqual([
        ["ApprovalGranted", "Merging"],
        ["MergeBlocked", "Held"],
      ]);
      expect(t.changes()[1]?.heldReason).toBe("MergeBlocked");
    }

    const t = setup({ state: "AwaitingApproval" });
    t.store.seed(approved());
    t.clock.ms = T0 + 120_000;
    t.prMergeStateOf.mockRejectedValueOnce(new Error("sem rede"));
    await expect(t.dispatcher.listReady()).resolves.toEqual([]);
    expect(t.changes()).toHaveLength(0);
    expect(t.issues.rows.get(13)?.state).toBe("AwaitingApproval");
    expect(t.log).toHaveBeenCalledWith("Falha ao despachar a issue 13: sem rede");
    await t.dispatcher.listReady();
    expect(t.changes()).toHaveLength(2);

    for (const done of ["Done", "Held"]) {
      const d = setup({ state: done });
      d.store.seed(approved());
      await d.dispatcher.listReady();
      expect(d.prMergeStateOf).not.toHaveBeenCalled();
      expect(d.events.list("p", 13)).toHaveLength(0);
    }
  });

  it("logs and does nothing when AwaitingApproval has no request", async () => {
    const t = setup({ state: "AwaitingApproval" });
    await expect(t.dispatcher.listReady()).resolves.toEqual([]);
    expect(t.events.list("p", 13)).toHaveLength(0);
    expect(t.log).toHaveBeenCalledWith(
      "A issue 13 em AwaitingApproval não tem pedido de aprovação",
    );
  });

  it("logs and does nothing when an approved request has no decidedAt", async () => {
    const t = setup({ state: "AwaitingApproval" });
    t.store.seed(record({ decision: "approved" }));
    await t.dispatcher.listReady();
    expect(t.events.list("p", 13)).toHaveLength(0);
    expect(t.prMergeStateOf).not.toHaveBeenCalled();
    expect(t.log).toHaveBeenCalledWith(
      "O pedido de aprovação 0a1b2c3d da issue 13 está aprovado sem decidedAt",
    );
  });

  it("still applies the gate labels when storing the approval request fails", async () => {
    const t = setup();
    vi.spyOn(t.store, "insert").mockImplementation(() => {
      throw new Error("disco cheio");
    });
    await t.dispatcher.listReady();
    expect(t.github.labelCalls).toContainEqual({ issue: 13, label: "gate:security" });
    expect(t.log).not.toHaveBeenCalledWith(expect.stringContaining("gate:security"));
  });
});
