import {
  createWorkflow,
  transition,
  type WorkflowInput,
  type WorkflowSnapshot,
} from "@friday/domain";
import { describe, expect, it } from "vitest";
import {
  APPROVAL_TTL_MS,
  decideApproval,
  requestApproval,
  type ApprovalRecord,
  type ApprovalStore,
  type EventStore,
  type MergeResult,
  type NewEvent,
  type StoredEvent,
  type UnitOfWork,
} from "../src/index.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const T0 = 1_000_000;
const ID = "e5f0b0c9";

const unitOfWork: UnitOfWork = { run: (work) => work() };

function memoryStore(forceDecideFalse = false): ApprovalStore {
  const rows = new Map<string, ApprovalRecord>();
  return {
    insert(r) {
      if (rows.has(r.id)) throw new Error("id repetido");
      rows.set(r.id, { ...r });
    },
    get: (id) => {
      const r = rows.get(id);
      return r ? { ...r } : null;
    },
    listPending: (projectId, now) =>
      [...rows.values()].filter(
        (r) => r.projectId === projectId && r.decision === null && r.expiresAt > now,
      ),
    latestForIssue: (projectId, issueId) =>
      [...rows.values()]
        .filter((r) => r.projectId === projectId && r.issueId === issueId)
        .sort((a, b) => b.requestedAt - a.requestedAt || (a.id < b.id ? 1 : -1))[0] ?? null,
    decide(id, d) {
      const r = rows.get(id);
      if (forceDecideFalse || !r || r.decision !== null) return false;
      Object.assign(r, { decision: d.decision, decidedAt: d.decidedAt, decidedBy: d.decidedBy });
      return true;
    },
  };
}

function memoryEvents(): EventStore & { all: StoredEvent[] } {
  const all: StoredEvent[] = [];
  return {
    all,
    append(e: NewEvent) {
      const s = { ...e, seq: all.length + 1 };
      all.push(s);
      return s;
    },
    list: () => all,
  };
}

function setup(opts?: {
  head?: string;
  merge?: () => Promise<MergeResult>;
  forceDecideFalse?: boolean;
}) {
  let clock = T0;
  const store = memoryStore(opts?.forceDecideFalse);
  const events = memoryEvents();
  const merges: Array<[number, string]> = [];
  let headReads = 0;
  const github = {
    squashMerge: (pr: number, sha: string): Promise<MergeResult> => {
      merges.push([pr, sha]);
      return opts?.merge ? opts.merge() : Promise.resolve({ merged: true, sha: "m1" });
    },
  };
  const readPrHead = (): Promise<string> => {
    headReads += 1;
    return Promise.resolve(opts?.head ?? A);
  };
  const now = () => clock;
  const request = () =>
    requestApproval(
      { store, events, unitOfWork, now, newId: () => ID },
      { projectId: "p", issueId: 7, pr: 30, headSha: A, tier: "high" },
    );
  const decide = (decision: "approve" | "deny", at: number, actor = "human:cli") => {
    clock = at;
    return decideApproval(
      { store, events, unitOfWork, github, readPrHead, now },
      { id: ID, decision, actor },
    );
  };
  return { store, events, merges, request, decide, reads: () => headReads };
}

const awaiting = (): WorkflowSnapshot => {
  const created = createWorkflow("7");
  if (!created.ok) throw new Error("workflow inválido");
  return { ...created.value, state: "AwaitingApproval" };
};
const apply = (inputs: WorkflowInput[]): WorkflowSnapshot => {
  let snap = awaiting();
  for (const i of inputs) {
    const r = transition(snap, i);
    if (!r.ok) throw new Error("transição inválida");
    snap = r.value.snapshot;
  }
  return snap;
};
const decidedEvents = (e: { all: StoredEvent[] }) =>
  e.all.filter((x) => x.type === "ApprovalDecided");

describe("approval gate", () => {
  it("requests an approval with short id, head sha, tier and 30 minute expiry", () => {
    const s = setup();
    const rec = s.request();
    expect(APPROVAL_TTL_MS).toBe(1_800_000);
    expect(rec).toMatchObject({
      id: ID,
      headSha: A,
      tier: "high",
      requestedAt: T0,
      expiresAt: T0 + 1_800_000,
      decision: null,
    });
    expect(s.store.get(ID)).toEqual(rec);
    expect(s.events.all).toHaveLength(1);
    const event = { ...s.events.all[0]!, seq: undefined };
    delete event.seq;
    expect(event).toEqual({
      projectId: "p",
      issueId: 7,
      runId: null,
      type: "ApprovalRequested",
      payload: {
        id: ID,
        pr: 30,
        headSha: A,
        tier: "high",
        requestedAt: T0,
        expiresAt: T0 + 1_800_000,
      },
      actor: "daemon",
      at: "1970-01-01T00:16:40.000Z",
    });
  });

  it("approves before expiry and squash merges the approved sha once", async () => {
    const s = setup({ head: A });
    s.request();
    const out = await s.decide("approve", T0 + 1_799_999);
    expect(out).toEqual({
      kind: "merged",
      sha: "m1",
      inputs: [
        {
          type: "ApprovalGranted",
          headSha: A,
          prHeadSha: A,
          decidedAt: T0 + 1_799_999,
          expiresAt: T0 + 1_800_000,
        },
        { type: "Merged" },
      ],
    });
    expect(s.merges).toEqual([[30, A]]);
    if (out.kind !== "merged") throw new Error("esperado merged");
    expect(apply(out.inputs.slice(0, 1)).state).toBe("Merging");
    expect(apply(out.inputs).state).toBe("Done");
  });

  it("never merges before approve and holds on deny", async () => {
    const s = setup();
    s.request();
    expect(s.merges).toHaveLength(0);
    const out = await s.decide("deny", T0 + 10);
    expect(out).toEqual({ kind: "denied", inputs: [{ type: "ApprovalDenied" }] });
    expect(s.merges).toHaveLength(0);
    if (out.kind !== "denied") throw new Error("esperado denied");
    const held = apply(out.inputs);
    expect(held.state).toBe("Held");
    expect(held.heldReason).toBe("ApprovalDenied");

    const late = setup();
    late.request();
    expect((await late.decide("deny", T0 + 1_800_001)).kind).toBe("denied");
  });

  it("refuses approve at or after expiry with Held ApprovalExpired", async () => {
    const s = setup();
    s.request();
    const out = await s.decide("approve", T0 + 1_800_000);
    expect(out.kind).toBe("expired");
    if (out.kind !== "expired") throw new Error("esperado expired");
    const held = apply(out.inputs);
    expect(held.state).toBe("Held");
    expect(held.heldReason).toBe("ApprovalExpired");
    expect(s.merges).toHaveLength(0);
    expect(s.store.get(ID)?.decision).toBeNull();
    expect(decidedEvents(s.events)).toHaveLength(0);
  });

  it("refuses approve when the PR head changed with Held HeadChanged", async () => {
    const s = setup({ head: B });
    s.request();
    const out = await s.decide("approve", T0 + 5);
    expect(out.kind).toBe("head_changed");
    if (out.kind !== "head_changed") throw new Error("esperado head_changed");
    const held = apply(out.inputs);
    expect(held.state).toBe("Held");
    expect(held.heldReason).toBe("HeadChanged");
    expect(s.merges).toHaveLength(0);
    expect(decidedEvents(s.events)).toHaveLength(0);

    const both = setup({ head: B });
    both.request();
    expect((await both.decide("approve", T0 + 1_800_000)).kind).toBe("expired");
    expect(both.reads()).toBe(1);
  });

  it("holds with MergeBlocked when GitHub refuses the squash", async () => {
    const s = setup({ merge: () => Promise.resolve({ merged: false, reason: "head_changed" }) });
    s.request();
    const out = await s.decide("approve", T0 + 5);
    expect(out.kind).toBe("merge_blocked");
    if (out.kind !== "merge_blocked") throw new Error("esperado merge_blocked");
    expect(out.inputs.at(-1)).toEqual({ type: "MergeBlocked" });
    const held = apply(out.inputs);
    expect(held.state).toBe("Held");
    expect(held.heldReason).toBe("MergeBlocked");
    expect(s.store.get(ID)?.decision).toBe("approved");
    expect(decidedEvents(s.events)).toHaveLength(1);

    const boom = setup({ merge: () => Promise.reject(new Error("falha 502")) });
    boom.request();
    await expect(boom.decide("approve", T0 + 5)).rejects.toThrow("falha 502");
    expect(boom.store.get(ID)?.decision).toBe("approved");
  });

  it("decides only once and reports unknown ids", async () => {
    const s = setup();
    s.request();
    await s.decide("approve", T0 + 5);
    const eventsBefore = s.events.all.length;
    expect(await s.decide("approve", T0 + 6)).toEqual({ kind: "already_decided" });
    expect(await s.decide("deny", T0 + 7)).toEqual({ kind: "already_decided" });
    expect(s.merges).toHaveLength(1);
    expect(s.events.all).toHaveLength(eventsBefore);

    const u = setup();
    const out = await decideApproval(
      {
        store: u.store,
        events: u.events,
        unitOfWork,
        github: { squashMerge: () => Promise.reject(new Error("não deveria")) },
        readPrHead: () => Promise.reject(new Error("não deveria")),
        now: () => T0,
      },
      { id: "inexistente", decision: "approve", actor: "human:cli" },
    );
    expect(out).toEqual({ kind: "unknown" });

    const race = setup({ forceDecideFalse: true });
    race.store.insert({
      id: ID,
      projectId: "p",
      issueId: 7,
      pr: 30,
      headSha: A,
      tier: "high",
      requestedAt: T0,
      expiresAt: T0 + APPROVAL_TTL_MS,
      decision: null,
      decidedAt: null,
      decidedBy: null,
    });
    expect(await race.decide("approve", T0 + 5)).toEqual({ kind: "already_decided" });
    expect(race.merges).toHaveLength(0);
    expect(decidedEvents(race.events)).toHaveLength(0);
  });

  it("records human:cli as the actor of the decision", async () => {
    const s = setup();
    s.request();
    await s.decide("approve", T0 + 5, "human:cli");
    const [ev] = decidedEvents(s.events);
    expect(ev?.actor).toBe("human:cli");
    expect(ev?.payload).toMatchObject({ id: ID, decision: "approved" });
    expect(s.store.get(ID)?.decidedBy).toBe("human:cli");

    const d = setup();
    d.request();
    await d.decide("deny", T0 + 5, "human:cli");
    expect(decidedEvents(d.events)[0]?.payload).toMatchObject({ id: ID, decision: "denied" });
    expect(d.store.get(ID)?.decidedBy).toBe("human:cli");
  });
  it("keeps the #92 behaviour with an inline unit of work", async () => {
    const calls: string[] = [];
    const tracked: UnitOfWork = {
      run: (work) => {
        calls.push("run");
        return work();
      },
    };
    const store = memoryStore();
    const events = memoryEvents();
    const github = { squashMerge: () => Promise.resolve({ merged: true, sha: "m1" } as const) };
    requestApproval(
      { store, events, unitOfWork: tracked, now: () => T0, newId: () => ID },
      { projectId: "p", issueId: 7, pr: 30, headSha: A, tier: "high" },
    );
    expect(calls).toEqual(["run"]);
    const out = await decideApproval(
      {
        store,
        events,
        unitOfWork: tracked,
        github,
        readPrHead: () => Promise.resolve(A),
        now: () => T0 + 5,
      },
      { id: ID, decision: "approve", actor: "human:cli" },
    );
    expect(out).toMatchObject({ kind: "merged", sha: "m1" });
    expect(calls).toEqual(["run", "run"]);
    expect(store.latestForIssue("p", 7)?.decision).toBe("approved");
  });
});
