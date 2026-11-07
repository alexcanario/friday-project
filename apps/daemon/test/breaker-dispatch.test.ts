import { describe, expect, it } from "vitest";
import { createRunRecorder } from "../src/index.ts";
import { beginRun, completeRun, type RegistrationEnv } from "../src/run-registration.ts";
import { FakeEvents, FakeIssueRepository, FakeRunRepository, fakeRequest } from "./fakes.ts";
import { ScriptedRuntime, T0, setup, type Step } from "./breaker-dispatch-helpers.ts";

describe("onRuntimeFailure in completeRun", () => {
  function regSetup(steps: Step[], recordFails = false) {
    const events = new FakeEvents();
    const runs = new FakeRunRepository();
    const issueRepo = new FakeIssueRepository(events);
    issueRepo.row = {
      projectId: "p",
      issueId: 7,
      state: "InProgress",
      heldReason: null,
      verifyRound: 0,
      qaRound: 0,
      reviewIter: 0,
    };
    const recorder = createRunRecorder({
      projectId: "p",
      events,
      issues: issueRepo,
      now: () => new Date(T0),
    });
    if (recordFails) {
      recorder.recordFinished = () => {
        throw new Error("record");
      };
    }
    const logs: string[] = [];
    const calls = { n: 0, fail: false };
    const env: RegistrationEnv = {
      projectId: "p",
      now: () => new Date(T0).toISOString(),
      events,
      runtime: new ScriptedRuntime(steps),
      buildRequest: (id) => fakeRequest(id),
      recording: { runs, recorder, newRunId: () => "r1" },
      logError: (m, e) => logs.push(`${m}: ${e instanceof Error ? e.message : String(e)}`),
      onRuntimeFailure: () => {
        calls.n += 1;
        if (calls.fail) throw new Error("breaker");
      },
    };
    return { env, calls, logs, runs };
  }

  const exec = async (t: ReturnType<typeof regSetup>) => completeRun(t.env, beginRun(t.env, 7));

  it("calls onRuntimeFailure only for failed, timeout and a thrown run", async () => {
    const expected: [Step, number][] = [
      ["failed", 1],
      ["timeout", 1],
      [new Error("boom"), 1],
      ["succeeded", 0],
      ["budget_exceeded", 0],
      ["turns_exceeded", 0],
      ["invalid_output", 0],
      ["misconfigured", 0],
    ];
    for (const [step, n] of expected) {
      const t = regSetup([step]);
      await exec(t);
      expect(t.calls.n, String(step)).toBe(n);
    }
    const t = regSetup(["failed"], true);
    await exec(t);
    expect(t.calls.n).toBe(1);
  });

  it("logs a throwing onRuntimeFailure and still closes the run", async () => {
    const t = regSetup(["failed"]);
    t.calls.fail = true;
    await exec(t);
    expect(t.logs).toContain("Failed to record breaker failure for run r1: breaker");
    expect(t.runs.rows.get("r1")?.status).toBe("failed");
    expect(t.calls.n).toBe(1);
  });
});

describe("breaker in the ticker", () => {
  it("holds BreakerOpen without calling the runtime", async () => {
    const t = setup({ open: true });
    await t.ticker.tick();
    await t.ticker.idle();
    expect(t.runtime.requests).toHaveLength(0);
    expect(t.runCount()).toBe(0);
    expect(t.dispatched()).toBe(0);
    expect(t.issues.get("p", 7)).toMatchObject({ state: "Held", heldReason: "BreakerOpen" });
    const closed = setup({ open: false });
    await closed.ticker.tick();
    await closed.ticker.idle();
    expect(closed.runtime.requests).toHaveLength(1);
  });

  it("does not dispatch when RunHeld is not accepted or isOpen throws", async () => {
    const backlog = setup({ open: true, state: "Backlog" });
    await backlog.ticker.tick();
    await backlog.ticker.idle();
    expect(backlog.runtime.requests).toHaveLength(0);
    expect(backlog.runCount()).toBe(0);
    expect(backlog.issues.get("p", 7)?.state).toBe("Backlog");
    expect(backlog.logs.some((l) => l.includes("issue 7"))).toBe(true);

    const bad = setup({ isOpenThrows: true });
    await bad.ticker.tick();
    await bad.ticker.idle();
    expect(bad.runtime.requests).toHaveLength(0);
    expect(bad.runCount()).toBe(0);
    expect(bad.dispatched()).toBe(0);
    expect(bad.issues.get("p", 7)?.state).toBe("InProgress");
    expect(bad.logs).toContain("Failed to dispatch issue 7: estado ilegível");
  });

  it("dispatches normally without deps.breaker", async () => {
    const t = setup({ open: true });
    await t.plain.tick();
    await t.plain.idle();
    expect(t.runtime.requests).toHaveLength(1);
    expect(t.issues.get("p", 7)?.heldReason).not.toBe("BreakerOpen");
  });

  it("checks the breaker before the budget", async () => {
    const open = setup({ open: true });
    await open.ticker.tick();
    expect(open.issues.get("p", 7)).toMatchObject({ heldReason: "BreakerOpen" });
    expect(open.sums.n).toBe(0);
    const closed = setup({ open: false });
    closed.db.sqlite
      .prepare(
        "INSERT INTO ledger (project_id, run_id, day, cost_usd, issue_id) VALUES ('p','x','2026-11-07',100,8)",
      )
      .run();
    await closed.ticker.tick();
    expect(closed.issues.get("p", 7)).toMatchObject({ heldReason: "BudgetExhausted" });
    expect(closed.runtime.requests).toHaveLength(0);
  });
});
