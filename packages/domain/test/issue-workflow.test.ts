import { describe, expect, it } from "vitest";
import {
  HELD_REASONS,
  ISSUE_STATES,
  RUN_HELD_REASONS,
  TRANSITIONS,
  createWorkflow,
  transition,
  type IssueState,
  type WorkflowInput,
} from "../src/index.ts";
import { INPUTS, INPUT_TYPES, snap } from "./fixtures.ts";

type Case = [IssueState, WorkflowInput, IssueState, object?];

const allowed: Case[] = [
  ["Backlog", INPUTS.Admitted, "Todo"],
  ["Todo", INPUTS.NeedsTriage, "Triage"],
  ["Todo", INPUTS.SpecialistAssigned, "InProgress"],
  ["Triage", INPUTS.SpecialistAssigned, "InProgress"],
  ["Triage", INPUTS.TriageFailed, "Held"],
  ["InProgress", INPUTS.PhaseCompleted, "InProgress"],
  ["InProgress", INPUTS.WorkReported, "Verify", { phaseIndex: 1 }],
  ["Triage", INPUTS.RunHeld, "Held"],
  ["InProgress", INPUTS.RunHeld, "Held"],
  ["Verify", INPUTS.RunHeld, "Held"],
  ["QA", INPUTS.RunHeld, "Held"],
  ["InReview", INPUTS.RunHeld, "Held"],
  ["Verify", INPUTS.VerifyPassed, "QA"],
  ["Verify", INPUTS.VerifyFailed, "InProgress"],
  ["Verify", INPUTS.VerifyTimedOut, "Held"],
  ["Verify", INPUTS.VerifyHeadChanged, "Held"],
  ["QA", INPUTS.QaPassed, "InReview"],
  ["QA", INPUTS.QaFailed, "InProgress"],
  ["QA", INPUTS.QaModifiedCode, "Held"],
  ["InReview", INPUTS.ReviewApproved, "RiskCheck"],
  ["InReview", INPUTS.ChangesRequested, "InProgress"],
  ["InReview", INPUTS.ReviewRejected, "Held"],
  ["RiskCheck", INPUTS.RiskAssessed, "Merging"],
  ["AwaitingApproval", INPUTS.ApprovalGranted, "Merging"],
  ["AwaitingApproval", INPUTS.ApprovalDenied, "Held"],
  ["AwaitingApproval", INPUTS.ApprovalExpired, "Held"],
  ["Merging", INPUTS.Merged, "Done"],
  ["Merging", INPUTS.MergeBlocked, "Held"],
  ["Held", INPUTS.Resumed, "InProgress"],
  ["Held", INPUTS.CancelRequested, "Canceled"],
];

describe("issue workflow", () => {
  it("holds with HeadChanged on VerifyHeadChanged only from Verify", () => {
    const r = transition(snap("Verify"), INPUTS.VerifyHeadChanged);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.snapshot.state).toBe("Held");
      expect(r.value.snapshot.heldReason).toBe("HeadChanged");
      expect(r.value.event).toMatchObject({
        type: "StateChanged",
        trigger: "VerifyHeadChanged",
      });
    }
    for (const state of ["Triage", "InProgress", "QA"] as const) {
      expect(transition(snap(state), INPUTS.VerifyHeadChanged)).toEqual({
        ok: false,
        error: "InvalidTransition",
      });
    }
  });

  it("exposes the states and held reasons", () => {
    expect(ISSUE_STATES).toHaveLength(13);
    expect(new Set(ISSUE_STATES).size).toBe(13);
    expect(new Set(HELD_REASONS).size).toBe(HELD_REASONS.length);
    expect(HELD_REASONS).toContain("SpecialistWithoutAgent");
    expect(RUN_HELD_REASONS).toContain("SpecialistWithoutAgent");
    expect(TRANSITIONS).toHaveLength(30);
    expect(allowed).toHaveLength(30);
    expect(INPUT_TYPES).toHaveLength(25);
  });

  it.each(allowed)("applies every allowed transition %s %j -> %s", (from, input, to, extra) => {
    const result = transition(snap(from, extra ?? {}), input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.snapshot.state).toBe(to);
  });

  const pairs = ISSUE_STATES.flatMap((state) => INPUT_TYPES.map((type) => [state, type] as const));
  const allowedKeys = new Set(allowed.map(([f, i]) => `${f}:${i.type}`));
  const forbidden = pairs.filter(([s, t]) => !allowedKeys.has(`${s}:${t}`));

  it("rejects every other state and input pair", () => {
    expect(forbidden).toHaveLength(295);
    for (const [state, type] of forbidden) {
      const result = transition(snap(state), INPUTS[type]);
      expect(result, `${state} ${type}`).toEqual({ ok: false, error: "InvalidTransition" });
    }
  });

  it("emits the state changed event", () => {
    const result = transition(snap("Verify"), INPUTS.VerifyPassed);
    expect(result.ok && result.value.event).toEqual({
      type: "StateChanged",
      issueId: "i-1",
      from: "Verify",
      to: "QA",
      trigger: "VerifyPassed",
      heldReason: null,
    });
    const held = transition(snap("Triage"), INPUTS.TriageFailed);
    expect(held.ok && held.value.event).toMatchObject({
      to: "Held",
      heldReason: "TriageFailed",
    });
  });

  it("never mutates the snapshot", () => {
    const deepFreeze = <T extends object>(o: T): T => {
      for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v);
      return Object.freeze(o);
    };
    const input = deepFreeze(snap("Verify"));
    const copy = structuredClone(input);
    const result = transition(input, deepFreeze(structuredClone(INPUTS.VerifyFailed)));
    expect(result.ok).toBe(true);
    expect(input).toEqual(copy);
    const created = createWorkflow("i-1");
    expect(created.ok && created.value.state).toBe("Backlog");
  });

  it("records the reason of each hold", () => {
    const cases: [IssueState, WorkflowInput, string][] = [
      ["Triage", INPUTS.TriageFailed, "TriageFailed"],
      ["Verify", INPUTS.VerifyTimedOut, "VerifyTimeout"],
      ["Verify", INPUTS.VerifyHeadChanged, "HeadChanged"],
      ["QA", INPUTS.QaModifiedCode, "QaModifiedCode"],
      ["InReview", INPUTS.ReviewRejected, "ReviewRejected"],
      ["AwaitingApproval", INPUTS.ApprovalDenied, "ApprovalDenied"],
      ["AwaitingApproval", INPUTS.ApprovalExpired, "ApprovalExpired"],
      ["Merging", INPUTS.MergeBlocked, "MergeBlocked"],
    ];
    for (const [from, input, reason] of cases) {
      const r = transition(snap(from), input);
      if (!r.ok) throw new Error(`${from} ${input.type}`);
      expect(r.value.snapshot).toMatchObject({ state: "Held", heldReason: reason });
      expect(r.value.event).toMatchObject({ to: "Held", heldReason: reason });
    }
  });

  it("exposes the states and held reasons by name", () => {
    expect(ISSUE_STATES).toEqual(
      expect.arrayContaining([
        "Backlog",
        "Todo",
        "Triage",
        "InProgress",
        "Verify",
        "QA",
        "InReview",
        "RiskCheck",
        "AwaitingApproval",
        "Merging",
        "Held",
        "Done",
        "Canceled",
      ]),
    );
    expect(HELD_REASONS).toEqual(
      expect.arrayContaining([
        "TriageFailed",
        "RunMisconfigured",
        "BudgetExceeded",
        "TurnsExceeded",
        "RuntimeFailed",
        "BreakerOpen",
        "BudgetExhausted",
        "IssueBudgetExceeded",
        "SchemaInvalid",
        "VerifyRoundsExhausted",
        "VerifyTimeout",
        "QaRoundsExhausted",
        "QaModifiedCode",
        "ReviewItersExhausted",
        "ReviewRejected",
        "ApprovalDenied",
        "ApprovalExpired",
        "HeadChanged",
        "MergeBlocked",
        "ConfidenceBelowHigh",
        "IncidentOpen",
        "Reconciled",
        "PausedByHuman",
      ]),
    );
  });

  it("never mutates the snapshot on any allowed pair", () => {
    const deepFreeze = <T extends object>(o: T): T => {
      for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v);
      return Object.freeze(o);
    };
    expect(allowed).toHaveLength(30);
    for (const [from, input, , extra] of allowed) {
      const frozen = deepFreeze(structuredClone(snap(from, extra ?? {})));
      const copy = structuredClone(frozen);
      const r = transition(frozen, deepFreeze(structuredClone(input)));
      expect(r.ok, `${from} ${input.type}`).toBe(true);
      expect(frozen).toEqual(copy);
    }
  });
});
