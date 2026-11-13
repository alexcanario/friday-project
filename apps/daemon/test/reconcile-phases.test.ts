import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorktreeInfo, WorktreeManager } from "@friday/application";
import { ISSUE_STATES } from "@friday/domain";
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
const ROOT = "/repo";
const TERMINAL: readonly string[] = ["Done", "Canceled"];

let db: FridayDatabase;
beforeEach(() => {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), "friday-reconcile-ph-")), "friday.db"));
  db.sqlite.prepare("INSERT INTO projects (id) VALUES (?)").run("p");
});
afterEach(() => db.close());

function seedIssue(issue: number, to: string, heldReason: string | null = null) {
  createEventStore(db).append({
    projectId: "p",
    issueId: issue,
    runId: null,
    type: "StateChanged",
    actor: "seed",
    at: NOW,
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
  createIssueRepository(db).rebuild("p");
}

const wt = (issue: number): WorktreeInfo => ({ issue, path: `/wt/${issue}`, head: "abc" });

/** Same rule as `GitWorktreeManager.listOrphans`: only worktrees outside `activeIssues`. */
function fakeWorktrees(present: WorktreeInfo[]) {
  const listCalls: { activeIssues: number[] }[] = [];
  const removeCalls: number[] = [];
  const manager = {
    listOrphans(request: { activeIssues: number[] }) {
      listCalls.push(request);
      const active = new Set(request.activeIssues);
      return Promise.resolve({ ok: true, value: present.filter((w) => !active.has(w.issue)) });
    },
    remove(request: { issue: number }) {
      removeCalls.push(request.issue);
      return Promise.resolve({ ok: true, value: undefined });
    },
  } as unknown as WorktreeManager;
  return { manager, listCalls, removeCalls };
}

function run(worktrees: WorktreeManager) {
  return reconcile({
    projectId: "p",
    root: ROOT,
    runs: createRunRepository(db),
    issues: createIssueRepository(db),
    events: createEventStore(db),
    worktrees,
    now: () => new Date(NOW),
  });
}

describe("reconcile keeps the worktrees of issues between phases", () => {
  it("keeps the worktree of an InReview issue without an active run", async () => {
    seedIssue(7, "InReview");
    const fake = fakeWorktrees([wt(7)]);
    const report = await run(fake.manager);
    expect(fake.removeCalls).toEqual([]);
    expect(report.removedWorktrees).toEqual([]);
    expect(fake.listCalls[0]!.activeIssues).toContain(7);
  });

  it("keeps the worktree of an issue in any non-terminal state", async () => {
    const states = ISSUE_STATES.filter((s) => !TERMINAL.includes(s));
    expect(states.length).toBeGreaterThan(5);
    for (const [i, state] of states.entries()) {
      const issue = 100 + i;
      seedIssue(issue, state, state === "Held" ? "RuntimeFailed" : null);
      const fake = fakeWorktrees([wt(issue)]);
      const report = await run(fake.manager);
      expect(fake.removeCalls, state).toEqual([]);
      expect(report.removedWorktrees, state).toEqual([]);
      expect(fake.listCalls[0]!.activeIssues, state).toContain(issue);
    }
  });

  it("removes the worktree of a Done and of a Canceled issue", async () => {
    seedIssue(8, "Done");
    seedIssue(9, "Canceled");
    const fake = fakeWorktrees([wt(8), wt(9)]);
    const report = await run(fake.manager);
    expect([...fake.removeCalls].sort()).toEqual([8, 9]);
    expect([...report.removedWorktrees].sort()).toEqual([8, 9]);
    expect(fake.listCalls[0]!.activeIssues).not.toContain(8);
    expect(fake.listCalls[0]!.activeIssues).not.toContain(9);
  });

  it("removes the worktree of an issue unknown to the database", async () => {
    seedIssue(8, "InReview");
    const fake = fakeWorktrees([wt(42)]);
    const report = await run(fake.manager);
    expect(fake.removeCalls).toEqual([42]);
    expect(report.removedWorktrees).toEqual([42]);
    expect(fake.listCalls[0]!.activeIssues).not.toContain(42);
  });

  it("keeps the worktree of an InProgress issue whose run reconcile canceled", async () => {
    seedIssue(16, "InProgress");
    createRunRepository(db).save({
      id: "ra16",
      projectId: "p",
      issueId: 16,
      phase: null,
      startedAt: null,
      finishedAt: null,
      status: "running",
    });
    const fake = fakeWorktrees([wt(16)]);
    const report = await run(fake.manager);
    expect(report.canceledRuns).toEqual(["ra16"]);
    expect(createRunRepository(db).get("ra16")?.status).toBe("canceled_by_reconciliation");
    expect(createIssueRepository(db).get("p", 16)).toMatchObject({
      state: "Held",
      heldReason: "Reconciled",
    });
    expect(fake.removeCalls).toEqual([]);
    expect(report.removedWorktrees).toEqual([]);
    expect(fake.listCalls[0]!.activeIssues).toContain(16);
  });
});
