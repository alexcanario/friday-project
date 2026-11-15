import { describe, expect, it } from "vitest";
import { FakeEvents } from "./fakes.ts";

const ev = (projectId: string, issueId: number) => ({
  projectId,
  issueId,
  runId: null,
  type: "Note",
  payload: {},
  actor: "test",
  at: "2026-01-01T00:00:00Z",
});

describe("FakeEvents listSince", () => {
  it("FakeEvents filters listSince like the SQLite store", () => {
    const store = new FakeEvents();
    const a = store.append(ev("p1", 1));
    store.append(ev("p2", 1));
    const b = store.append(ev("p1", 2));
    const c = store.append(ev("p1", 3));
    expect(store.listSince("p1", a.seq).map((e) => e.seq)).toEqual([b.seq, c.seq]);
    expect(store.listSince("p1", c.seq)).toEqual([]);
    expect(store.listSince("p2", 0).map((e) => e.projectId)).toEqual(["p2"]);
  });
});
