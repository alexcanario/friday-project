import type { GitHubPort } from "@friday/application";
import {
  createApprovalStore,
  createEventStore,
  createIssueRepository,
} from "@friday/infrastructure";
import { describe, expect, it } from "vitest";
import { composeDaemon, type ComposeOptions, type Daemon } from "../src/index.ts";
import { ApprovalFakeGitHub } from "./approval-fakes.ts";
import { NOW, setup } from "./compose-helpers.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);

function scenario() {
  const t = setup();
  const github = new ApprovalFakeGitHub();
  github.issues.push({ number: 13, title: "T", body: "", labels: ["friday"] });
  github.diffs.set(5, {
    files: [{ path: "src/a.ts", changedLines: 1, hasPatch: true }],
    diffBytes: 100,
  });
  const opts: ComposeOptions = {
    ...t.opts,
    createGitHub: () => github as unknown as GitHubPort,
    newApprovalId: () => "0a1b2c3d",
    prOf: (i) => (i === 13 ? 5 : null),
  };
  return { t, github, opts };
}

function seed(daemon: Daemon, issueId: number, from: string, to: string) {
  createEventStore(daemon.db).append({
    projectId: "p",
    issueId,
    runId: null,
    type: "StateChanged",
    actor: "daemon",
    at: NOW.toISOString(),
    payload: {
      type: "StateChanged",
      issueId: String(issueId),
      from,
      to,
      trigger: "WorkReported",
      heldReason: null,
      verifyRound: 0,
      qaRound: 0,
      reviewIter: 0,
    },
  });
  createIssueRepository(daemon.db).rebuild("p");
}

const stateOf = (d: Daemon, n = 13) => createIssueRepository(d.db).get("p", n);
const rows = (d: Daemon, sql: string) => d.db.sqlite.prepare(sql).all();
const requested = (d: Daemon) =>
  rows(d, "SELECT seq FROM events WHERE type = 'ApprovalRequested' AND issue_id = 13");

async function tick(d: Daemon) {
  await d.ticker.tick();
  await d.ticker.idle();
}

function approved() {
  return {
    id: "0a1b2c3d",
    projectId: "p",
    issueId: 13,
    pr: 5,
    headSha: A,
    tier: "high" as const,
    requestedAt: NOW.getTime() - 1000,
    expiresAt: NOW.getTime() + 3600000,
    decision: "approved" as const,
    decidedAt: NOW.getTime(),
    decidedBy: "alex",
  };
}

async function reconcileCase(head: string) {
  const s = scenario();
  s.github.prMergeState = { merged: true, headSha: head };
  const daemon = await composeDaemon(s.opts);
  seed(daemon, 13, "Merging", "AwaitingApproval");
  createApprovalStore(daemon.db).insert(approved());
  await tick(daemon);
  const row = stateOf(daemon);
  const calls = s.github.mergeStateCalls;
  daemon.release();
  return { row, calls };
}

describe("composeDaemon approval wiring", () => {
  it("requests approval on RiskCheck through composeDaemon", async () => {
    const s = scenario();
    const daemon = await composeDaemon(s.opts);
    seed(daemon, 13, "Review", "RiskCheck");
    await tick(daemon);
    expect(stateOf(daemon)?.state).toBe("AwaitingApproval");
    expect(rows(daemon, "SELECT id, issue_id, pr, head_sha FROM approvals")).toEqual([
      { id: "0a1b2c3d", issue_id: 13, pr: 5, head_sha: A },
    ]);
    expect(requested(daemon)).toHaveLength(1);
    expect(s.github.mergeStateCalls).toContain(5);
    daemon.release();
  });

  it("leaves RiskCheck without a request when getPrMergeState fails and retries next tick", async () => {
    const s = scenario();
    s.github.mergeStateFailure = new Error("sem rede");
    const daemon = await composeDaemon(s.opts);
    seed(daemon, 13, "Review", "RiskCheck");
    await tick(daemon);
    expect(stateOf(daemon)?.state).toBe("RiskCheck");
    expect(rows(daemon, "SELECT count(*) AS n FROM approvals")).toEqual([{ n: 0 }]);
    expect(requested(daemon)).toHaveLength(0);
    s.github.mergeStateFailure = null;
    await tick(daemon);
    expect(stateOf(daemon)?.state).toBe("AwaitingApproval");
    expect(rows(daemon, "SELECT count(*) AS n FROM approvals")).toEqual([{ n: 1 }]);
    daemon.release();
  });

  it("reconciles an approved request to Done or Held MergeBlocked by the PR state", async () => {
    const same = await reconcileCase(A);
    expect(same.row?.state).toBe("Done");
    expect(same.calls).toContain(5);
    const other = await reconcileCase(B);
    expect(other.row?.state).toBe("Held");
    expect(other.row?.heldReason).toBe("MergeBlocked");
    expect(other.calls).toContain(5);
  });

  it("calls getPrMergeState only for pending approvals and never logs the token", async () => {
    const s = scenario();
    s.github.issues.push({ number: 14, title: "U", body: "", labels: ["friday"] });
    s.github.prMergeState = { merged: true, headSha: A };
    const daemon = await composeDaemon(s.opts);
    seed(daemon, 13, "Merging", "AwaitingApproval");
    seed(daemon, 14, "Backlog", "Todo");
    createApprovalStore(daemon.db).insert(approved());
    await tick(daemon);
    expect(s.github.mergeStateCalls).toEqual([5]);
    expect(s.t.logs.join("\n")).not.toContain("t0k3n");
    daemon.release();

    const only = scenario();
    only.github.issues.length = 0;
    only.github.issues.push({ number: 14, title: "U", body: "", labels: ["friday"] });
    const d2 = await composeDaemon(only.opts);
    seed(d2, 14, "Backlog", "Todo");
    await tick(d2);
    expect(only.github.mergeStateCalls).toEqual([]);
    d2.release();
  });
});
