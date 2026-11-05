import { describe, expect, it } from "vitest";
import {
  HELD_REASONS,
  createWorkflow,
  transition,
  type HeldReason, type IssueState, type WorkflowInput,
} from "../src/index.ts";
import { INPUTS, snap } from "./fixtures.ts";

type Counter = "verifyRound" | "qaRound" | "reviewIter";

function repeat(state: IssueState, input: WorkflowInput, counter: Counter, reason: HeldReason) {
  let current = snap(state);
  for (const expected of [1, 2]) {
    const r = transition(current, input);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.snapshot.state).toBe("InProgress");
    expect(r.value.snapshot[counter]).toBe(expected);
    current = { ...r.value.snapshot, state };
  }
  const third = transition(current, input);
  if (!third.ok) throw new Error(third.error);
  expect(third.value.snapshot.state).toBe("Held");
  expect(third.value.snapshot.heldReason).toBe(reason);
  expect(third.value.snapshot[counter]).toBe(3);
}

describe("rounds", () => {
  it("holds on the third verify failure", () => {
    repeat("Verify", INPUTS.VerifyFailed, "verifyRound", "VerifyRoundsExhausted");
  });
  it("holds on the third qa failure", () => {
    repeat("QA", INPUTS.QaFailed, "qaRound", "QaRoundsExhausted");
  });
  it("holds on the third changes request", () => {
    repeat("InReview", INPUTS.ChangesRequested, "reviewIter", "ReviewItersExhausted");
  });

  it("resets on resume and cancels from held", () => {
    const base = { verifyRound: 3, qaRound: 2, reviewIter: 1 };
    const cases: [HeldReason, Counter][] = [
      ["VerifyRoundsExhausted", "verifyRound"],
      ["QaRoundsExhausted", "qaRound"],
      ["ReviewItersExhausted", "reviewIter"],
    ];
    for (const [reason, counter] of cases) {
      const s = snap("Held", { ...base, heldReason: reason, phaseIndex: 1 });
      const r = transition(s, INPUTS.Resumed);
      if (!r.ok) throw new Error(r.error);
      expect(r.value.snapshot).toMatchObject({
        state: "InProgress",
        heldReason: null,
        phaseIndex: 0,
        ...base,
        phases: s.phases,
        [counter]: 0,
      });
    }
    const paused = snap("Held", { verifyRound: 2, heldReason: "PausedByHuman" });
    const r = transition(paused, INPUTS.Resumed);
    expect(r.ok && r.value.snapshot.verifyRound).toBe(2);
    const c = transition(paused, INPUTS.CancelRequested);
    expect(c.ok && c.value.snapshot.state).toBe("Canceled");
  });

  it("keeps the counters along the real path", () => {
    const created = createWorkflow("i-1");
    if (!created.ok) throw new Error(created.error);
    let s = created.value;
    const steps = [
      "Admitted",
      "SpecialistAssigned",
      "PhaseCompleted",
      "WorkReported",
      "VerifyFailed",
      "PhaseCompleted",
      "WorkReported",
      "VerifyPassed",
      "QaFailed",
      "PhaseCompleted",
      "WorkReported",
      "VerifyPassed",
      "QaPassed",
      "ChangesRequested",
    ] as const;
    for (const type of steps) {
      const r = transition(s, INPUTS[type]);
      expect(r.ok, type).toBe(true);
      if (r.ok) s = r.value.snapshot;
    }
    expect(s).toMatchObject({ state: "InProgress", verifyRound: 1, qaRound: 1, reviewIter: 1 });
  });

  it("keeps the counters on the other held reasons", () => {
    const exhausted = ["VerifyRoundsExhausted", "QaRoundsExhausted", "ReviewItersExhausted"];
    const others = HELD_REASONS.filter((r) => !exhausted.includes(r));
    expect(others).toHaveLength(20);
    for (const heldReason of others) {
      const s = snap("Held", { heldReason, verifyRound: 1, qaRound: 1, reviewIter: 1 });
      const r = transition(s, INPUTS.Resumed);
      if (!r.ok) throw new Error(r.error);
      expect(r.value.snapshot, heldReason).toMatchObject({
        state: "InProgress",
        verifyRound: 1,
        qaRound: 1,
        reviewIter: 1,
      });
    }
  });
});
