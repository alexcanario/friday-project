import { RUN_STATUSES, type RunFinished } from "@friday/contracts";
import { RUN_HELD_REASONS } from "@friday/domain";
import { describe, expect, it } from "vitest";
import { heldReasonFor } from "../src/index.ts";

const finished = (status: RunFinished["status"]): RunFinished => ({
  status,
  subtype: null,
  model: null,
  costUsd: null,
  tokens: null,
  numTurns: null,
  durationMs: null,
  output: null,
  violations: [],
});

describe("heldReasonFor", () => {
  it("maps each status to its held reason", () => {
    const expected = {
      succeeded: null,
      budget_exceeded: "BudgetExceeded",
      turns_exceeded: "TurnsExceeded",
      invalid_output: "SchemaInvalid",
      misconfigured: "RunMisconfigured",
      timeout: "RuntimeFailed",
      failed: "RuntimeFailed",
    };
    expect(RUN_STATUSES).toHaveLength(7);
    for (const status of RUN_STATUSES) {
      const reason = heldReasonFor(finished(status));
      expect(reason).toBe(expected[status]);
      if (reason !== null) expect(RUN_HELD_REASONS).toContain(reason);
    }
  });
});
