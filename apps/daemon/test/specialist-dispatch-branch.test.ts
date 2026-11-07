import { describe, expect, it, vi } from "vitest";
import type { IssueRow } from "@friday/application";
import { createStateDispatcher, type StateDispatcherDeps } from "../src/index.ts";
import { FakeEvents, FakeGitHub, FakeIssueRepository, fakeRequest } from "./fakes.ts";

const row = (issueId: number, state: string): IssueRow => ({
  projectId: "p",
  issueId,
  state,
  heldReason: null,
  verifyRound: 0,
  qaRound: 0,
  reviewIter: 0,
});

type Fn = NonNullable<StateDispatcherDeps["specialist"]>;
type Pending = { resolve: () => void };

function setup(specialist: Fn | undefined, states: [number, string][] = [[7, "InProgress"]]) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events);
  const github = new FakeGitHub();
  for (const [id, state] of states) {
    issues.rows.set(id, row(id, state));
    github.issues.push({ number: id, title: `t${id}`, body: "", labels: ["friday"] });
  }
  const qa = vi.fn(() => Promise.resolve({ applied: true, feedback: null }));
  const judge = vi.fn(() => Promise.resolve({ applied: true, feedback: null }));
  const deps: StateDispatcherDeps = {
    projectId: "p",
    github,
    issues,
    events,
    roles: { specialist: (id) => fakeRequest(id) },
    readConfig: () => null,
    prOf: () => 30,
    now: () => new Date("2026-11-07T03:00:00.000Z"),
    qa,
    judge,
    ...(specialist ? { specialist } : {}),
  };
  return { dispatcher: createStateDispatcher(deps), qa, judge };
}

function pendingFn() {
  const pending: Pending[] = [];
  const fn = vi.fn<Fn>(
    () =>
      new Promise((resolve) => {
        pending.push({ resolve: () => resolve({ applied: true, feedback: null }) });
      }),
  );
  return { fn, pending };
}

describe("state dispatcher specialist branch", () => {
  it("dispatches InProgress to the specialist branch outside roles, once, and shares capacity with QA and Judge", async () => {
    const p = pendingFn();
    const t = setup(p.fn);
    const first = t.dispatcher.listReady();
    await Promise.resolve();
    expect(p.fn).toHaveBeenCalledExactlyOnceWith(7);
    expect(t.dispatcher.busy()).toBe(1);
    const second = t.dispatcher.listReady();
    await Promise.resolve();
    expect(p.fn).toHaveBeenCalledTimes(1);
    p.pending[0]?.resolve();
    await expect(first).resolves.toEqual([]);
    await second;
    expect(t.dispatcher.busy()).toBe(0);
    expect(() => t.dispatcher.buildRequest(7)).toThrow();

    const capped = pendingFn();
    const c = setup(capped.fn);
    await c.dispatcher.listReady({ active: 1, max: 1 });
    expect(capped.fn).not.toHaveBeenCalled();

    const shared = pendingFn();
    const s = setup(shared.fn, [
      [7, "InProgress"],
      [8, "QA"],
      [9, "InReview"],
    ]);
    const running = s.dispatcher.listReady({ active: 0, max: 1 });
    await Promise.resolve();
    const other = s.dispatcher.listReady({ active: 0, max: 1 });
    await Promise.resolve();
    expect(s.qa).not.toHaveBeenCalled();
    expect(s.judge).not.toHaveBeenCalled();
    shared.pending[0]?.resolve();
    await running;
    await other;

    const legacy = setup(undefined);
    await expect(legacy.dispatcher.listReady()).resolves.toEqual([7]);
    expect(() => legacy.dispatcher.buildRequest(7)).not.toThrow();
  });
});
