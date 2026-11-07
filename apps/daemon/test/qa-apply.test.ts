import { describe, expect, it } from "vitest";
import type { IssueRow } from "@friday/application";
import { applyQaOutcome } from "../src/qa-apply.ts";
import type { QaStepOutcome } from "@friday/application";
import { FakeEvents, FakeIssueRepository } from "./fakes.ts";

const ctx = { issueId: 7, runId: "r1" };
const now = () => new Date("2026-11-05T03:00:00.000Z");
const FEEDBACK = "Critério 2 reprovado: c — botão não aparece";
const failed: QaStepOutcome = {
  input: { type: "QaFailed" },
  failed: [{ index: 2, claim: "c", how: "botão não aparece" }],
  feedback: FEEDBACK,
};
const passed: QaStepOutcome = { input: { type: "QaPassed" } };

const qaRow = (over: Partial<IssueRow> = {}): IssueRow => ({
  projectId: "p",
  issueId: 7,
  state: "QA",
  heldReason: null,
  verifyRound: 0,
  qaRound: 0,
  reviewIter: 0,
  ...over,
});

function setup(row: IssueRow | null) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events);
  issues.row = row;
  const apply = (outcome: QaStepOutcome) =>
    applyQaOutcome({ projectId: "p", events, issues, now }, ctx, outcome);
  return { events, issues, apply };
}

const changed = (to: string, trigger: string, extra: Record<string, unknown> = {}) => ({
  type: "StateChanged",
  issueId: "7",
  from: "QA",
  to,
  trigger,
  heldReason: null,
  verifyRound: 0,
  qaRound: 0,
  reviewIter: 0,
  ...extra,
});

describe("applyQaOutcome", () => {
  it("records StateChanged to InReview on QaPassed and rebuilds after the append", () => {
    const { events, issues, apply } = setup(qaRow());
    expect(apply(passed)).toEqual({ applied: true, feedback: null });
    expect(events.appended).toHaveLength(1);
    expect(events.appended[0]).toMatchObject({
      type: "StateChanged",
      projectId: "p",
      issueId: 7,
      runId: "r1",
      actor: "daemon",
      at: "2026-11-05T03:00:00.000Z",
      payload: changed("InReview", "QaPassed"),
    });
    expect(issues.rebuilds).toEqual([{ projectId: "p", appendedCount: 1 }]);
  });

  it("returns to InProgress with feedback on QaFailed and holds on the third failure", () => {
    const first = setup(qaRow());
    expect(first.apply(failed)).toEqual({ applied: true, feedback: FEEDBACK });
    expect(first.events.appended[0]).toMatchObject({
      payload: changed("InProgress", "QaFailed", { qaRound: 1 }),
    });
    const expected = [
      ["InProgress", 1, null],
      ["InProgress", 2, null],
      ["Held", 3, "QaRoundsExhausted"],
    ] as const;
    expected.forEach(([to, round, held], n) => {
      const t = setup(qaRow({ qaRound: n }));
      expect(t.apply(failed)).toEqual({ applied: true, feedback: FEEDBACK });
      expect(t.events.appended[0]).toMatchObject({
        payload: changed(to, "QaFailed", { qaRound: round, heldReason: held }),
      });
    });
  });

  it("holds with QaModifiedCode and with a RunHeld reason", () => {
    const a = setup(qaRow());
    expect(a.apply({ input: { type: "QaModifiedCode" } })).toEqual({
      applied: true,
      feedback: null,
    });
    expect(a.events.appended[0]).toMatchObject({
      payload: changed("Held", "QaModifiedCode", { heldReason: "QaModifiedCode" }),
    });
    const b = setup(qaRow());
    const outcome: QaStepOutcome = {
      input: { type: "RunHeld", reason: "SchemaInvalid" },
      violations: [],
    };
    expect(b.apply(outcome)).toEqual({ applied: true, feedback: null });
    expect(b.events.appended[0]).toMatchObject({
      payload: { to: "Held", heldReason: "SchemaInvalid" },
    });
  });

  it("records nothing for a missing row, an invalid state, an invalid heldReason or an invalid transition", () => {
    const rows = [
      null,
      qaRow({ state: "Bogus" }),
      qaRow({ heldReason: "Bogus" }),
      qaRow({ state: "Verify" }),
    ];
    for (const row of rows) {
      for (const outcome of [failed, passed]) {
        const t = setup(row);
        expect(t.apply(outcome)).toEqual({ applied: false, feedback: null });
        expect(t.events.appended).toHaveLength(0);
        expect(t.issues.rebuilds).toEqual([]);
      }
    }
  });
});
