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

type JudgeFn = NonNullable<StateDispatcherDeps["judge"]>;

function setup(judge: JudgeFn | undefined, withJudgeRole = false) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events);
  const github = new FakeGitHub();
  for (const [id, state] of [
    [7, "InReview"],
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
      ...(withJudgeRole ? { judge: (id: number) => fakeRequest(id) } : {}),
    },
    readConfig: () => null,
    prOf: () => 30,
    now: () => new Date("2026-11-05T03:00:00.000Z"),
    log,
    ...(judge ? { judge } : {}),
  };
  return { dispatcher: createStateDispatcher(deps), log };
}

const done = { applied: true, feedback: null };

describe("state dispatcher judge branch", () => {
  it("dispatches InReview to the judge branch outside roles", async () => {
    const judge = vi.fn<JudgeFn>(() => Promise.resolve(done));
    const t = setup(judge, true);
    const ready = await t.dispatcher.listReady();
    expect(judge).toHaveBeenCalledExactlyOnceWith(7);
    expect(ready).toEqual([8]);
    expect(() => t.dispatcher.buildRequest(7)).toThrow();
  });

  it("does not call judge for other states and keeps the role without judge", async () => {
    const judge = vi.fn<JudgeFn>(() => Promise.resolve(done));
    await setup(judge).dispatcher.listReady();
    expect(judge).not.toHaveBeenCalledWith(8);
    const legacy = setup(undefined, true);
    await expect(legacy.dispatcher.listReady()).resolves.toEqual([7, 8]);
  });

  it("skips reentrant calls while the judge is running", async () => {
    let release: (v: typeof done) => void = () => {};
    const judge = vi.fn<JudgeFn>(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const t = setup(judge);
    const first = t.dispatcher.listReady();
    const second = await t.dispatcher.listReady();
    expect(judge).toHaveBeenCalledTimes(1);
    expect(second).not.toContain(7);
    release(done);
    expect(await first).not.toContain(7);
    await t.dispatcher.listReady();
    expect(judge).toHaveBeenCalledTimes(2);
  });

  it("logs and survives a rejecting judge", async () => {
    const t = setup(() => Promise.reject(new Error("falhou")));
    await expect(t.dispatcher.listReady()).resolves.toEqual([8]);
    expect(t.log).toHaveBeenCalledTimes(1);
  });
});
