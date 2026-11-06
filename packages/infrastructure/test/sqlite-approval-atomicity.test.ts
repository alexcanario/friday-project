import { describe, expect, it } from "vitest";
import {
  decideApproval,
  requestApproval,
  type EventStore,
  type NewEvent,
} from "@friday/application";
import {
  createApprovalStore,
  createEventStore,
  createUnitOfWork,
  type FridayDatabase,
} from "../src/index.ts";
import { openWithProjects } from "./sqlite-fixtures.ts";

const A = "a".repeat(40);
const ID = "0a1b2c3d";
const T0 = 1_000_000;

function setup() {
  const db: FridayDatabase = openWithProjects("p");
  const store = createApprovalStore(db);
  const real = createEventStore(db);
  const state = { failOn: null as string | null };
  const events: EventStore = {
    append(e: NewEvent) {
      if (e.type === state.failOn) throw new Error("boom");
      return real.append(e);
    },
    list: (p, i) => real.list(p, i),
  };
  const merges: Array<{ inTx: boolean; decision: string | null | undefined }> = [];
  const github = {
    squashMerge: (): Promise<{ merged: true; sha: string }> => {
      merges.push({ inTx: db.sqlite.inTransaction, decision: store.get(ID)?.decision });
      return Promise.resolve({ merged: true, sha: "m1" });
    },
  };
  const unitOfWork = createUnitOfWork(db);
  const request = () =>
    requestApproval(
      { store, events, unitOfWork, now: () => T0, newId: () => ID },
      { projectId: "p", issueId: 7, pr: 30, headSha: A, tier: "high" },
    );
  const decide = (decision: "approve" | "deny") =>
    decideApproval(
      { store, events, unitOfWork, github, readPrHead: () => Promise.resolve(A), now: () => T0 + 5 },
      { id: ID, decision, actor: "human:cli" },
    );
  const count = (type: string) => real.list("p", 7).filter((e) => e.type === type).length;
  return { state, store, merges, request, decide, count };
}

describe("approval atomicity", () => {
  it("rolls back the request when the event append fails", () => {
    const s = setup();
    s.state.failOn = "ApprovalRequested";
    expect(() => s.request()).toThrow("boom");
    expect(s.store.get(ID)).toBeNull();
    s.state.failOn = null;
    s.request();
    expect(s.store.get(ID)).not.toBeNull();
    expect(s.count("ApprovalRequested")).toBe(1);
  });

  it("rolls back the decision when the event append fails", async () => {
    const s = setup();
    s.request();
    s.state.failOn = "ApprovalDecided";
    await expect(s.decide("approve")).rejects.toThrow("boom");
    expect(s.store.get(ID)?.decision).toBeNull();
    expect(s.merges).toHaveLength(0);
    s.state.failOn = null;
    expect(await s.decide("approve")).toMatchObject({ kind: "merged" });
    expect(s.count("ApprovalDecided")).toBe(1);
    expect(s.merges).toHaveLength(1);
    expect(await s.decide("approve")).toEqual({ kind: "already_decided" });
    expect(s.count("ApprovalDecided")).toBe(1);
  });

  it("rolls back a denial when the event append fails", async () => {
    const s = setup();
    s.request();
    s.state.failOn = "ApprovalDecided";
    await expect(s.decide("deny")).rejects.toThrow("boom");
    expect(s.store.get(ID)?.decision).toBeNull();
    s.state.failOn = null;
    expect(await s.decide("deny")).toMatchObject({ kind: "denied" });
    expect(s.count("ApprovalDecided")).toBe(1);
  });

  it("merges only after the decision is committed", async () => {
    const s = setup();
    s.request();
    await s.decide("approve");
    expect(s.merges).toEqual([{ inTx: false, decision: "approved" }]);
  });
});
