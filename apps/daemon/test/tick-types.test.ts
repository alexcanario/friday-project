import { describe, expect, it } from "vitest";
import { createTicker, type RunRecordingDeps } from "../src/index.ts";
import type { BudgetDeps } from "../src/budget-gate.ts";
import { FakeClock, FakeEvents, FakeIssues, FakeRunRepository, PendingRuntime } from "./fakes.ts";

describe("ticker types", () => {
  it("requires budget together with recording", () => {
    const events = new FakeEvents();
    const base = {
      projectId: "p",
      clock: new FakeClock(),
      readConfig: () => null,
      issues: new FakeIssues(),
      buildRequest: () => {
        throw new Error("unused");
      },
      runtime: new PendingRuntime(),
      events,
    };
    const recording: RunRecordingDeps = { runs: new FakeRunRepository(), recorder: {} as never };
    const budget = {} as BudgetDeps;
    // @ts-expect-error recording requires budget
    createTicker({ ...base, recording });
    expect(createTicker({ ...base, recording, budget })).toBeDefined();
  });
});
