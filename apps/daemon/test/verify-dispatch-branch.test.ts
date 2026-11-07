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

type Fn = NonNullable<StateDispatcherDeps["verify"]>;
const done = { applied: true, feedback: null };

function setup(verify: Fn | undefined, states: [number, string][], withRole = false) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events);
  const github = new FakeGitHub();
  for (const [id, state] of states) {
    issues.rows.set(id, row(id, state));
    github.issues.push({ number: id, title: `t${id}`, body: "", labels: ["friday"] });
  }
  const log = vi.fn<(m: string) => void>();
  const qa = vi.fn(() => Promise.resolve(done));
  const judge = vi.fn(() => Promise.resolve(done));
  const specialist = vi.fn(() => Promise.resolve(done));
  const deps: StateDispatcherDeps = {
    projectId: "p",
    github,
    issues,
    events,
    roles: withRole ? { verify: (id) => fakeRequest(id) } : {},
    readConfig: () => null,
    prOf: () => 30,
    now: () => new Date("2026-11-05T03:00:00.000Z"),
    log,
    qa,
    judge,
    specialist,
    ...(verify ? { verify } : {}),
  };
  return { dispatcher: createStateDispatcher(deps), log, qa, judge, specialist };
}

describe("state dispatcher verify branch", () => {
  it("dispatches Verify to its own branch outside roles, once, sharing capacity with the other branches", async () => {
    const verify = vi.fn<Fn>(() => Promise.resolve(done));
    const t = setup(verify, [[7, "Verify"]], true);
    await expect(t.dispatcher.listReady()).resolves.toEqual([]);
    expect(verify).toHaveBeenCalledExactlyOnceWith(7);
    expect(() => t.dispatcher.buildRequest(7)).toThrow();

    const legacy = setup(undefined, [[7, "Verify"]], true);
    await expect(legacy.dispatcher.listReady()).resolves.toEqual([7]);

    let release: (v: typeof done) => void = () => {};
    const pending = vi.fn<Fn>(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const s = setup(pending, [
      [7, "Verify"],
      [8, "QA"],
      [9, "InReview"],
      [10, "InProgress"],
    ]);
    const first = s.dispatcher.listReady({ active: 0, max: 1 });
    await Promise.resolve();
    expect(pending).toHaveBeenCalledTimes(1);
    expect(s.dispatcher.busy()).toBe(1);
    await s.dispatcher.listReady({ active: 0, max: 1 });
    expect(pending).toHaveBeenCalledTimes(1);
    expect(s.qa).not.toHaveBeenCalled();
    expect(s.judge).not.toHaveBeenCalled();
    expect(s.specialist).not.toHaveBeenCalled();
    release(done);
    await first;
    expect(s.dispatcher.busy()).toBe(0);

    const capped = vi.fn<Fn>(() => Promise.resolve(done));
    await setup(capped, [[7, "Verify"]]).dispatcher.listReady({ active: 1, max: 1 });
    expect(capped).not.toHaveBeenCalled();

    const failing = setup(
      vi.fn<Fn>(() => Promise.reject(new Error("boom"))),
      [
        [7, "Verify"],
        [8, "QA"],
      ],
    );
    await failing.dispatcher.listReady();
    expect(failing.log).toHaveBeenCalled();
    expect(failing.qa).toHaveBeenCalledWith(8);
  });
});
