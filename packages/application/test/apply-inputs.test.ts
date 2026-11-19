import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyInputs, type EventStore, type IssueRepository, type IssueRow } from "../src/index.ts";

function setup() {
  const appended: { actor: string; type: string }[] = [];
  let row: IssueRow = {
    issueId: 14,
    state: "AwaitingApproval",
    heldReason: null,
    verifyRound: 0,
    qaRound: 0,
    reviewIter: 0,
  } as unknown as IssueRow;
  const events = {
    append: (e: { actor: string; type: string }) => {
      appended.push({ actor: e.actor, type: e.type });
      return 1;
    },
  } as unknown as EventStore;
  const issues = {
    get: () => row,
    rebuild: () => {
      row = { ...row, state: "AwaitingApproval" } as IssueRow;
    },
  } as unknown as IssueRepository;
  return { appended, deps: { events, issues, now: () => 1_000 } };
}

describe("applyInputs", () => {
  it("records the given actor on the state change", () => {
    for (const actor of ["human:panel", "human:cli"]) {
      const { appended, deps } = setup();
      applyInputs(deps, {
        projectId: "p1",
        issueId: 14,
        inputs: [{ type: "ApprovalDenied" }],
        actor,
      });
      expect(appended).toEqual([{ actor, type: "StateChanged" }]);
    }
    expect(existsSync(resolve(import.meta.dirname, "../../../apps/cli/src/apply-inputs.ts"))).toBe(
      false,
    );
  });
});
