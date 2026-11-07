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

type QaFn = NonNullable<StateDispatcherDeps["qa"]>;
const done = { applied: true, feedback: null };

function setup(qa: QaFn | undefined, withQaRole = false) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events);
  const github = new FakeGitHub();
  for (const [id, state] of [
    [7, "QA"],
    [8, "InProgress"],
  ] as const) {
    issues.rows.set(id, row(id, state));
    github.issues.push({ number: id, title: `t${id}`, body: "", labels: ["friday"] });
  }
  const log = vi.fn<(m: string) => void>();
  const deps: StateDispatcherDeps = {
    projectId: "p",
    github,
    issues,
    events,
    roles: {
      specialist: (id) => fakeRequest(id),
      ...(withQaRole ? { qa: (id: number) => fakeRequest(id) } : {}),
    },
    readConfig: () => null,
    prOf: () => 30,
    now: () => new Date("2026-11-05T03:00:00.000Z"),
    log,
    ...(qa ? { qa } : {}),
  };
  return { dispatcher: createStateDispatcher(deps), log };
}

describe("state dispatcher qa branch", () => {
  it("dispatches QA to the qa branch outside roles and keeps the role without qa", async () => {
    const qa = vi.fn<QaFn>(() => Promise.resolve(done));
    const t = setup(qa, true);
    await expect(t.dispatcher.listReady()).resolves.toEqual([8]);
    expect(qa).toHaveBeenCalledExactlyOnceWith(7);
    expect(() => t.dispatcher.buildRequest(7)).toThrow();
    const legacy = setup(undefined, true);
    await expect(legacy.dispatcher.listReady()).resolves.toEqual([7, 8]);
    expect(() => legacy.dispatcher.buildRequest(7)).not.toThrow();
    const failing = setup(
      vi.fn<QaFn>(() => Promise.reject(new Error("boom"))),
      true,
    );
    await expect(failing.dispatcher.listReady()).resolves.toEqual([8]);
    expect(failing.log).toHaveBeenCalled();
  });

  it("does not run qa twice, respects capacity and counts in busy", async () => {
    let release: (v: typeof done) => void = () => {};
    const qa = vi.fn<QaFn>(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const t = setup(qa);
    const first = t.dispatcher.listReady();
    await t.dispatcher.listReady();
    expect(qa).toHaveBeenCalledTimes(1);
    expect(t.dispatcher.busy()).toBe(1);
    release(done);
    await first;
    expect(t.dispatcher.busy()).toBe(0);

    const capped = vi.fn<QaFn>(() => Promise.resolve(done));
    await setup(capped).dispatcher.listReady({ active: 1, max: 1 });
    expect(capped).not.toHaveBeenCalled();
  });
});
