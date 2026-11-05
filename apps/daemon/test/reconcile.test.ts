import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  RunRecordStatus,
  WorktreeError,
  WorktreeInfo,
  WorktreeManager,
} from "@friday/application";
import {
  createEventStore,
  createIssueRepository,
  createRunRepository,
  openDatabase,
  type FridayDatabase,
} from "@friday/infrastructure";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reconcile } from "../src/index.ts";

const NOW = "2026-11-05T03:00:00.000Z";
const FINISHED = "2026-11-05T00:00:00Z";
const ROOT = "/repo";

let db: FridayDatabase;
beforeEach(() => {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), "friday-reconcile-")), "friday.db"));
  for (const p of ["p", "q"]) db.sqlite.prepare("INSERT INTO projects (id) VALUES (?)").run(p);
});
afterEach(() => db.close());

const events = () => createEventStore(db);
const issues = () => createIssueRepository(db);
const runs = () => createRunRepository(db);

function seedIssue(project: string, issue: number, to: string, heldReason: string | null = null) {
  events().append({
    projectId: project,
    issueId: issue,
    runId: null,
    type: "StateChanged",
    actor: "seed",
    at: FINISHED,
    payload: {
      type: "StateChanged",
      issueId: String(issue),
      from: "Todo",
      to,
      trigger: "SpecialistAssigned",
      heldReason,
      verifyRound: 0,
      qaRound: 0,
      reviewIter: 0,
    },
  });
  issues().rebuild(project);
}

function seedRun(
  id: string,
  project: string,
  issueId: number,
  status: RunRecordStatus,
  finishedAt: string | null,
) {
  runs().save({ id, projectId: project, issueId, phase: null, startedAt: null, finishedAt, status });
}

type Call = { root: string; project: string; issue: number };

function fakeWorktrees(opts: {
  orphans: WorktreeInfo[] | WorktreeError;
  removeErrors?: Map<number, WorktreeError>;
}) {
  const listCalls: unknown[] = [];
  const removeCalls: Call[] = [];
  const present = Array.isArray(opts.orphans) ? [...opts.orphans] : [];
  const manager = {
    listOrphans(request: unknown) {
      listCalls.push(request);
      if (!Array.isArray(opts.orphans)) return Promise.resolve({ ok: false, error: opts.orphans });
      return Promise.resolve({ ok: true, value: [...present] });
    },
    remove(request: Call) {
      removeCalls.push(request);
      const error = opts.removeErrors?.get(request.issue);
      if (error) return Promise.resolve({ ok: false, error });
      const i = present.findIndex((w) => w.issue === request.issue);
      if (i >= 0) present.splice(i, 1);
      return Promise.resolve({ ok: true, value: undefined });
    },
  } as unknown as WorktreeManager;
  return { manager, listCalls, removeCalls };
}

const wt = (issue: number): WorktreeInfo => ({ issue, path: `/wt/${issue}`, head: "abc" });

function run(worktrees: WorktreeManager, projectId = "p") {
  return reconcile({
    projectId,
    root: ROOT,
    runs: runs(),
    issues: issues(),
    events: events(),
    worktrees,
    now: () => new Date(NOW),
  });
}

describe("reconcile", () => {
  it("cancels orphan runs, holds with Reconciled and is idempotent", async () => {
    seedIssue("p", 15, "InProgress");
    seedIssue("p", 16, "InProgress");
    seedRun("rs15", "p", 15, "succeeded", FINISHED);
    seedRun("ra16", "p", 16, "running", null);
    const fake = fakeWorktrees({ orphans: [wt(15), wt(16)] });

    const report = await run(fake.manager);
    expect(report).toEqual({
      canceledRuns: ["ra16"],
      heldIssues: [16],
      removedWorktrees: [15, 16],
      worktreeErrors: [],
    });
    expect(runs().get("ra16")).toMatchObject({
      status: "canceled_by_reconciliation",
      finishedAt: NOW,
    });
    expect(runs().get("rs15")).toMatchObject({ status: "succeeded", finishedAt: FINISHED });
    expect(issues().get("p", 16)).toMatchObject({ state: "Held", heldReason: "Reconciled" });
    expect(issues().get("p", 15)?.state).toBe("InProgress");
    const list16 = events().list("p", 16);
    expect(list16).toHaveLength(2);
    expect(list16[1]).toMatchObject({
      type: "StateChanged",
      actor: "daemon",
      runId: "ra16",
      at: NOW,
      payload: {
        type: "StateChanged",
        issueId: "16",
        from: "InProgress",
        to: "Held",
        trigger: "RunHeld",
        heldReason: "Reconciled",
        verifyRound: 0,
        qaRound: 0,
        reviewIter: 0,
      },
    });
    expect(events().list("p", 15)).toHaveLength(1);
    expect(fake.listCalls[0]).toEqual({ root: ROOT, project: "p", activeIssues: [] });
    expect(fake.removeCalls).toEqual([
      { root: ROOT, project: "p", issue: 15 },
      { root: ROOT, project: "p", issue: 16 },
    ]);

    const second = await run(fake.manager);
    expect(second.canceledRuns).toEqual([]);
    expect(second.heldIssues).toEqual([]);
    expect(events().list("p", 16)).toHaveLength(2);
    expect(fake.listCalls).toHaveLength(2);
    expect(fake.listCalls[1]).toEqual({ root: ROOT, project: "p", activeIssues: [] });
  });

  it("reconciles only the given project", async () => {
    seedIssue("p", 16, "InProgress");
    seedIssue("q", 20, "InProgress");
    seedRun("ra16", "p", 16, "running", null);
    seedRun("rq20", "q", 20, "running", null);
    await run(fakeWorktrees({ orphans: [] }).manager);
    expect(runs().get("rq20")).toMatchObject({ status: "running", finishedAt: null });
    expect(issues().get("q", 20)?.state).toBe("InProgress");
    expect(events().list("q", 20)).toHaveLength(1);
  });

  it("cancels the run without an event when the issue cannot be held", async () => {
    seedIssue("p", 1, "Todo");
    seedIssue("p", 2, "Held", "Reconciled");
    seedRun("r1", "p", 1, "running", null);
    seedRun("r2", "p", 2, "running", null);
    seedRun("r3", "p", 3, "running", null);
    const report = await run(fakeWorktrees({ orphans: [] }).manager);
    expect(report.canceledRuns.sort()).toEqual(["r1", "r2", "r3"]);
    expect(report.heldIssues).toEqual([]);
    for (const id of ["r1", "r2", "r3"]) {
      expect(runs().get(id)).toMatchObject({
        status: "canceled_by_reconciliation",
        finishedAt: NOW,
      });
    }
    expect(events().list("p", 1)).toHaveLength(1);
    expect(events().list("p", 2)).toHaveLength(1);
    expect(events().list("p", 3)).toEqual([]);
  });

  it("reports worktree failures without throwing", async () => {
    seedIssue("p", 16, "InProgress");
    seedRun("ra16", "p", 16, "running", null);
    const listError: WorktreeError = { code: "WorktreeCreateFailed", message: "x" };
    const failing = fakeWorktrees({ orphans: listError });
    const report = await run(failing.manager);
    expect(failing.removeCalls).toEqual([]);
    expect(runs().get("ra16")?.status).toBe("canceled_by_reconciliation");
    expect(report.worktreeErrors).toEqual([listError]);

    const removeError: WorktreeError = { code: "WorktreeRemoveFailed", message: "y" };
    const partial = fakeWorktrees({
      orphans: [wt(15), wt(16)],
      removeErrors: new Map([[15, removeError]]),
    });
    const second = await run(partial.manager);
    expect(second.removedWorktrees).toEqual([16]);
    expect(second.worktreeErrors).toEqual([removeError]);
  });

  it("is exported by the package index", () => {
    expect(typeof reconcile).toBe("function");
    expect(typeof openDatabase).toBe("function");
  });
});
