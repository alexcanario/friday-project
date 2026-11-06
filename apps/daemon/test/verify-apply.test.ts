import { describe, expect, it } from "vitest";
import type { IssueRow } from "@friday/application";
import * as daemon from "../src/index.ts";
import { applyVerifyOutcome } from "../src/verify-apply.ts";
import type { VerifyStepOutcome } from "../src/index.ts";
import { FakeEvents, FakeIssueRepository } from "./fakes.ts";

const ctx = { issueId: 7, runId: "r1" };
const now = () => new Date("2026-11-05T03:00:00.000Z");

function setup(row: Partial<IssueRow> | null) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events);
  issues.row =
    row === null
      ? null
      : {
          projectId: "p",
          issueId: 7,
          state: "Verify",
          heldReason: null,
          verifyRound: 0,
          qaRound: 0,
          reviewIter: 0,
          ...row,
        };
  const apply = (outcome: VerifyStepOutcome) =>
    applyVerifyOutcome({ projectId: "p", events, issues, now }, ctx, outcome);
  return { events, issues, apply };
}

const payloadOf = (to: string, trigger: string, extra: Record<string, unknown> = {}) => ({
  type: "StateChanged",
  issueId: "7",
  from: "Verify",
  to,
  trigger,
  heldReason: null,
  verifyRound: 0,
  qaRound: 0,
  reviewIter: 0,
  ...extra,
});

describe("applyVerifyOutcome", () => {
  it("records StateChanged to QA on VerifyPassed and rebuilds after the append", () => {
    const { events, issues, apply } = setup({});
    expect(apply({ input: { type: "VerifyPassed" } })).toEqual({ applied: true, feedback: null });
    expect(events.appended).toEqual([
      {
        type: "StateChanged",
        projectId: "p",
        issueId: 7,
        runId: "r1",
        actor: "daemon",
        at: "2026-11-05T03:00:00.000Z",
        payload: payloadOf("QA", "VerifyPassed"),
      },
    ]);
    expect(issues.rebuilds).toEqual([{ projectId: "p", appendedCount: 1 }]);
  });

  it("returns to InProgress with feedback on VerifyFailed and holds on the third failure", () => {
    const failed: VerifyStepOutcome = { input: { type: "VerifyFailed" }, feedback: "boom-marker" };
    const first = setup({ verifyRound: 0 });
    expect(first.apply(failed)).toEqual({ applied: true, feedback: "boom-marker" });
    expect(first.events.appended[0]?.payload).toMatchObject({
      to: "InProgress",
      trigger: "VerifyFailed",
      verifyRound: 1,
    });
    const third = setup({ verifyRound: 2 });
    expect(third.apply(failed)).toEqual({ applied: true, feedback: "boom-marker" });
    expect(third.events.appended[0]?.payload).toMatchObject({
      to: "Held",
      heldReason: "VerifyRoundsExhausted",
      verifyRound: 3,
    });
  });

  it("holds with VerifyTimeout, HeadChanged and RunMisconfigured", () => {
    const cases: [VerifyStepOutcome, string][] = [
      [{ input: { type: "VerifyTimedOut" } }, "VerifyTimeout"],
      [{ input: { type: "VerifyHeadChanged" } }, "HeadChanged"],
      [{ input: { type: "RunHeld", reason: "RunMisconfigured" } }, "RunMisconfigured"],
    ];
    for (const [outcome, reason] of cases) {
      const { events, issues, apply } = setup({});
      expect(apply(outcome)).toEqual({ applied: true, feedback: null });
      expect(events.appended).toHaveLength(1);
      expect(events.appended[0]?.payload).toMatchObject({ to: "Held", heldReason: reason });
      expect(issues.rebuilds).toHaveLength(1);
    }
  });

  it("records nothing for a missing row, an invalid state, an invalid heldReason or an invalid transition", () => {
    const passed: VerifyStepOutcome = { input: { type: "VerifyPassed" } };
    const rows: Partial<IssueRow>[] = [
      { state: "Bogus" },
      { state: "Held", heldReason: "Bogus" },
      { state: "InProgress" },
    ];
    for (const row of [null, ...rows]) {
      const { events, issues, apply } = setup(row);
      expect(apply(passed)).toEqual({ applied: false, feedback: null });
      expect(events.appended).toHaveLength(0);
      expect(issues.rebuilds).toHaveLength(0);
    }
  });

  it("is exported by the package index", () => {
    expect(typeof daemon.applyVerifyOutcome).toBe("function");
  });
});
