import { describe, expect, it, vi } from "vitest";
import type { IssueRow } from "@friday/application";
import { createStateDispatcher, type StateDispatcherDeps } from "../src/index.ts";
import { FakeEvents, FakeGitHub, FakeIssueRepository, fakeRequest } from "./fakes.ts";

const ISSUE = { number: 10, title: "API de fotos", body: "Criar endpoint", labels: ["friday"] };
const row = (issueId: number, state: string): IssueRow => ({
  projectId: "p",
  issueId,
  state,
  heldReason: null,
  verifyRound: 0,
  qaRound: 0,
  reviewIter: 0,
});
type Fn = NonNullable<StateDispatcherDeps["triage"]>;

function setup(triage: Fn | undefined, states: [number, string][], withRole = false) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events);
  const github = new FakeGitHub();
  const log = vi.fn<(m: string) => void>();
  for (const [id, state] of states) {
    issues.rows.set(id, row(id, state));
    github.issues.push({ ...ISSUE, number: id });
  }
  const deps: StateDispatcherDeps = {
    projectId: "p",
    github,
    issues,
    events,
    roles: withRole ? { triage: (id) => fakeRequest(id) } : {},
    readConfig: () => null,
    prOf: () => null,
    now: () => new Date("2026-11-07T03:00:00.000Z"),
    log,
    ...(triage ? { triage } : {}),
  };
  return { dispatcher: createStateDispatcher(deps), log };
}

const ok = () => Promise.resolve({ applied: true, feedback: null as null });

describe("state dispatcher triage branch", () => {
  it("dispatches Todo and Triage issues to the triage branch", async () => {
    const triage = vi.fn<Fn>(ok);
    const t = setup(triage, [
      [10, "Todo"],
      [11, "Triage"],
      [12, "InProgress"],
    ]);
    await expect(t.dispatcher.listReady()).resolves.toEqual([]);
    expect(triage).toHaveBeenCalledTimes(2);
    expect(triage).toHaveBeenCalledWith(ISSUE);
    expect(triage).toHaveBeenCalledWith({ ...ISSUE, number: 11 });
    expect(triage).not.toHaveBeenCalledWith({ ...ISSUE, number: 12 });
    expect(() => t.dispatcher.buildRequest(10)).toThrow("A issue 10 não foi despachada por estado");
    const roles = setup(undefined, [[10, "Todo"]], true);
    await expect(roles.dispatcher.listReady()).resolves.toEqual([10]);
  });

  it("respects capacity, does not reenter and survives a rejection", async () => {
    const full = vi.fn<Fn>(ok);
    const a = setup(full, [[10, "Todo"]]);
    await a.dispatcher.listReady({ active: 1, max: 1 });
    expect(full).not.toHaveBeenCalled();

    let release: () => void = () => undefined;
    const pending = vi.fn<Fn>(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ applied: true, feedback: null });
        }),
    );
    const b = setup(pending, [[10, "Todo"]]);
    const first = b.dispatcher.listReady();
    await Promise.resolve();
    await b.dispatcher.listReady();
    expect(pending).toHaveBeenCalledTimes(1);
    expect(b.dispatcher.busy()).toBe(1);
    release();
    await first;
    expect(b.dispatcher.busy()).toBe(0);

    const boom = vi.fn<Fn>(() => Promise.reject(new Error("boom")));
    const c = setup(boom, [[10, "Todo"]]);
    await expect(c.dispatcher.listReady()).resolves.toEqual([]);
    expect(c.log).toHaveBeenCalledWith("Falha ao rodar a triagem da issue 10: boom");
  });
});
