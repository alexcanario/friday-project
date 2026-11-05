import { describe, expect, it } from "vitest";
import { DEFAULT_PHASES, createWorkflow, currentPhase, transition } from "../src/index.ts";
import type { Phase, WorkflowSnapshot } from "../src/index.ts";
import { INPUTS, snap } from "./fixtures.ts";

const phase = (role: string): Phase => ({ role, inputs: [], outputs: [], deterministic: false });

function ok(r: ReturnType<typeof transition>) {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe("phases", () => {
  it("runs the phases of a pack in order", () => {
    const phases = [phase("design"), phase("implement")];
    let s: WorkflowSnapshot = snap("InProgress", { phases });
    expect(currentPhase(s)?.role).toBe("design");
    expect(transition(s, INPUTS.WorkReported)).toEqual({ ok: false, error: "InvalidTransition" });

    const first = ok(transition(s, INPUTS.PhaseCompleted));
    expect(first.event).toBeNull();
    s = first.snapshot;
    expect(currentPhase(s)?.role).toBe("implement");
    expect(transition(s, INPUTS.WorkReported)).toEqual({ ok: false, error: "InvalidTransition" });

    const second = ok(transition(s, INPUTS.PhaseCompleted));
    expect(second.event).toBeNull();
    s = second.snapshot;
    expect(currentPhase(s)).toBeNull();
    expect(transition(s, INPUTS.PhaseCompleted)).toEqual({ ok: false, error: "InvalidTransition" });

    s = ok(transition(s, INPUTS.WorkReported)).snapshot;
    expect(s.state).toBe("Verify");
    s = ok(transition(s, INPUTS.VerifyFailed)).snapshot;
    expect(currentPhase(s)?.role).toBe("design");

    expect(createWorkflow("i-1", [])).toEqual({ ok: false, error: "InvalidPhases" });
    const created = createWorkflow("i-1");
    expect(created.ok && created.value.phases).toEqual(DEFAULT_PHASES);
    expect(created.ok && created.value.phases.map((p) => p.role)).toEqual(["implement"]);
    expect(created.ok && created.value).toMatchObject({
      state: "Backlog",
      heldReason: null,
      verifyRound: 0,
      qaRound: 0,
      reviewIter: 0,
      phaseIndex: 0,
    });
  });

  it("restarts the phases on every return to in progress", () => {
    const phases = [phase("design"), phase("implement")];
    for (const [from, input] of [
      ["QA", INPUTS.QaFailed],
      ["InReview", INPUTS.ChangesRequested],
    ] as const) {
      const s = snap(from, { phases, phaseIndex: 2 });
      const r = ok(transition(s, input));
      expect(r.snapshot).toMatchObject({ state: "InProgress", phaseIndex: 0 });
      expect(currentPhase(r.snapshot)?.role).toBe("design");
    }
  });
});
