import { describe, expect, it } from "vitest";
import type { IssueRow, SpecialistStepOutcome } from "@friday/application";
import type { RunHeldReason } from "@friday/domain";
import { applySpecialistOutcome } from "../src/index.ts";
import { FakeEvents, FakeIssueRepository } from "./fakes.ts";

const now = () => new Date("2026-11-07T03:00:00.000Z");
const row = (state: string): IssueRow => ({
  projectId: "p",
  issueId: 7,
  state,
  heldReason: null,
  verifyRound: 0,
  qaRound: 0,
  reviewIter: 0,
});

function setup(state: string | null) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events, undefined, { projectFromEvents: true });
  if (state !== null) issues.rows.set(7, row(state));
  return { events, issues, deps: { projectId: "p", events, issues, now } };
}

const report = {
  summary: "s",
  headSha: "a".repeat(40),
  changedFiles: [],
  notDone: [],
};
const reported = (inputs: SpecialistStepOutcome["inputs"]): SpecialistStepOutcome =>
  ({ inputs, report }) as SpecialistStepOutcome;
const ctx = { issueId: 7, runId: "run-1" };

describe("applySpecialistOutcome", () => {
  it("folds PhaseCompleted and WorkReported into one StateChanged to Verify", () => {
    const t = setup("InProgress");
    const outcome = reported([{ type: "PhaseCompleted" }, { type: "WorkReported" }]);
    expect(applySpecialistOutcome(t.deps, ctx, outcome)).toEqual({ applied: true });
    expect(t.issues.rows.get(7)?.state).toBe("Verify");
    const list = t.events.list("p", 7);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      type: "StateChanged",
      runId: "run-1",
      payload: { from: "InProgress", to: "Verify" },
    });

    const wrong = setup("QA");
    expect(applySpecialistOutcome(wrong.deps, ctx, outcome)).toEqual({ applied: false });
    expect(wrong.events.list("p", 7)).toHaveLength(0);
    const missing = setup(null);
    expect(applySpecialistOutcome(missing.deps, ctx, outcome)).toEqual({ applied: false });
    const empty = setup("InProgress");
    expect(applySpecialistOutcome(empty.deps, ctx, reported([]))).toEqual({ applied: false });
    expect(empty.events.list("p", 7)).toHaveLength(0);
  });

  it("holds with a RunHeld reason and records nothing for an invalid one", () => {
    const t = setup("InProgress");
    const held = {
      inputs: [{ type: "RunHeld", reason: "SchemaInvalid" }],
      violations: [],
    } as SpecialistStepOutcome;
    expect(applySpecialistOutcome(t.deps, ctx, held)).toEqual({ applied: true });
    expect(t.issues.rows.get(7)).toMatchObject({ state: "Held", heldReason: "SchemaInvalid" });

    const bad = setup("InProgress");
    const invalid = {
      inputs: [{ type: "RunHeld", reason: "Nope" as unknown as RunHeldReason }],
      violations: [],
    } as SpecialistStepOutcome;
    expect(applySpecialistOutcome(bad.deps, ctx, invalid)).toEqual({ applied: false });
    expect(bad.events.list("p", 7)).toHaveLength(0);
  });
});
