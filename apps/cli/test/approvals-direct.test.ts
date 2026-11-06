import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApprovalRecord } from "@friday/application";
import {
  createApprovalStore,
  createEventStore,
  createIssueRepository,
  openDatabase,
  type FridayDatabase,
} from "@friday/infrastructure";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDirectClient } from "../src/direct-client.ts";

const A = "a".repeat(40);
const T0 = 1_000_000;

let db: FridayDatabase;
let nowValue: number;
let head: string;
let merge: { merged: true; sha: string } | { merged: false; reason: string };
let merges: [number, string][];

beforeEach(() => {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), "friday-appr-direct-")), "friday.db"));
  db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p1'), ('p2')").run();
  nowValue = T0 + 1000;
  head = A;
  merge = { merged: true, sha: "m1" };
  merges = [];
});
afterEach(() => db.close());

const store = () => createApprovalStore(db);
const events = () => createEventStore(db);
const issues = () => createIssueRepository(db);

function client() {
  return createDirectClient({
    store: store(),
    events: events(),
    issues: issues(),
    github: {
      squashMerge: async (pr: number, sha: string) => {
        merges.push([pr, sha]);
        return merge as never;
      },
    },
    readPrHead: async () => head,
    now: () => nowValue,
  });
}

function seed(skipIssue?: number) {
  const rows: [string, string, number, number][] = [
    ["00000001", "p1", 7, 30],
    ["00000002", "p1", 8, 31],
    ["00000003", "p1", 9, 32],
    ["00000004", "p2", 10, 33],
  ];
  for (const [id, projectId, issueId, pr] of rows) {
    const record: ApprovalRecord = {
      id,
      projectId,
      issueId,
      pr,
      headSha: A,
      tier: "high",
      requestedAt: T0,
      expiresAt: T0 + 1_800_000,
      decision: null,
      decidedAt: null,
      decidedBy: null,
    };
    store().insert(record);
    if (issueId === skipIssue) continue;
    events().append({
      projectId,
      issueId,
      runId: null,
      type: "StateChanged",
      actor: "seed",
      at: "2026-11-05T00:00:00Z",
      payload: {
        type: "StateChanged",
        issueId: String(issueId),
        from: "RiskCheck",
        to: "AwaitingApproval",
        trigger: "RiskAssessed",
        heldReason: null,
        verifyRound: 0,
        qaRound: 0,
        reviewIter: 0,
      },
    });
    issues().rebuild(projectId);
  }
}

const changes = (project: string, issue: number) =>
  events()
    .list(project, issue)
    .filter((e) => e.type === "StateChanged" && e.actor === "human:cli");

describe("friday approvals direct client", () => {
  it("lists only the pending approvals of the project", async () => {
    seed();
    const c = client();
    const p = (id: string, issueId: number, pr: number) => ({
      id,
      issueId,
      pr,
      headSha: A,
      tier: "high",
      requestedAt: T0,
      expiresAt: T0 + 1_800_000,
    });
    expect(await c.list("p1")).toEqual([p("00000001", 7, 30), p("00000002", 8, 31), p("00000003", 9, 32)]);
    expect(await c.list("p2")).toEqual([p("00000004", 10, 33)]);
    expect(await c.list("p3")).toEqual([]);
  });

  it("approves as human:cli, merges once and records the state changes", async () => {
    seed();
    const c = client();
    expect(await c.decide("00000001", "approve")).toEqual({ kind: "merged", sha: "m1" });
    expect(merges).toEqual([[30, A]]);
    const rec = store().get("00000001");
    expect(rec?.decision).toBe("approved");
    expect(rec?.decidedBy).toBe("human:cli");
    const ch = changes("p1", 7).map((e) => e.payload);
    expect(ch).toHaveLength(2);
    expect(ch[0]).toMatchObject({ trigger: "ApprovalGranted", from: "AwaitingApproval", to: "Merging" });
    expect(ch[1]).toMatchObject({ trigger: "Merged", to: "Done" });
    expect(issues().get("p1", 7)?.state).toBe("Done");
    const total = events().list("p1", 7).length;
    expect(await c.decide("00000001", "approve")).toEqual({ kind: "already_decided" });
    expect(merges).toHaveLength(1);
    expect(events().list("p1", 7)).toHaveLength(total);
  });

  it("denies as human:cli and holds the issue; unknown id changes nothing", async () => {
    seed();
    const c = client();
    expect(await c.decide("00000002", "deny")).toEqual({ kind: "denied" });
    expect(merges).toHaveLength(0);
    expect(store().get("00000002")?.decidedBy).toBe("human:cli");
    const ch = changes("p1", 8);
    expect(ch).toHaveLength(1);
    expect(ch[0]?.payload).toMatchObject({ trigger: "ApprovalDenied" });
    expect(issues().get("p1", 8)).toMatchObject({ state: "Held", heldReason: "ApprovalDenied" });
    const before = events().list("p1", 7).length;
    expect(await c.decide("inexistente", "approve")).toEqual({ kind: "unknown" });
    expect(events().list("p1", 7)).toHaveLength(before);
  });

  it("holds the issue with the matching reason on head_changed, expired and merge_blocked", async () => {
    seed();
    head = "b".repeat(40);
    expect(await client().decide("00000003", "approve")).toEqual({ kind: "head_changed" });
    expect(store().get("00000003")?.decision).toBeNull();
    expect(merges).toHaveLength(0);
    expect(issues().get("p1", 9)).toMatchObject({ state: "Held", heldReason: "HeadChanged" });
    const ch = changes("p1", 9);
    expect(ch).toHaveLength(1);
    expect(ch[0]?.payload).toMatchObject({ trigger: "ApprovalGranted" });
  });

  it("holds the issue as ApprovalExpired when the request expired", async () => {
    seed();
    nowValue = T0 + 1_800_000;
    expect(await client().decide("00000001", "approve")).toEqual({ kind: "expired" });
    expect(issues().get("p1", 7)).toMatchObject({ state: "Held", heldReason: "ApprovalExpired" });
  });

  it("holds the issue as MergeBlocked when the merge is refused", async () => {
    seed();
    merge = { merged: false, reason: "not_mergeable" };
    expect(await client().decide("00000001", "approve")).toEqual({ kind: "merge_blocked" });
    expect(store().get("00000001")?.decision).toBe("approved");
    expect(issues().get("p1", 7)).toMatchObject({ state: "Held", heldReason: "MergeBlocked" });
  });

  it("still merges when the issue does not exist, without recording state changes", async () => {
    seed(7);
    expect(await client().decide("00000001", "approve")).toEqual({ kind: "merged", sha: "m1" });
    expect(changes("p1", 7)).toHaveLength(0);
  });
});
