import { describe, expect, it } from "vitest";
import {
  approvalItem,
  daySum,
  errorResponse,
  healthResponse,
  issueItem,
  runItem,
  transitionItem,
} from "../src/index.ts";

describe("api response schemas", () => {
  it("accepts valid and rejects invalid API response payloads", () => {
    expect(healthResponse.parse({ status: "ok" })).toEqual({ status: "ok" });
    const run = {
      id: "r1",
      issueId: 14,
      phase: null,
      status: "running",
      startedAt: null,
      finishedAt: null,
      costUsd: null,
      numTurns: null,
    };
    expect(runItem.parse(run)).toEqual(run);
    const approval = {
      id: "a1",
      issueId: 14,
      pr: 5,
      headSha: "abc",
      tier: "low",
      requestedAt: 1,
      expiresAt: 2,
    };
    expect(approvalItem.parse(approval)).toEqual(approval);
    const issue = { issueId: 14, state: "ready", heldReason: null };
    expect(issueItem.parse(issue)).toEqual(issue);
    expect(daySum.safeParse({ costUsd: 1, anyCostUnknown: false }).success).toBe(true);
    expect(errorResponse.parse({ message: "x" })).toEqual({ message: "x" });
    expect(transitionItem.safeParse({ seq: 1 }).success).toBe(false);

    expect(healthResponse.safeParse({ status: "down" }).success).toBe(false);
    expect(runItem.safeParse({ ...run, status: "bogus" }).success).toBe(false);
    expect(approvalItem.safeParse({ ...approval, tier: "mid" }).success).toBe(false);
    expect(issueItem.safeParse({ issueId: 14, state: "ready" }).success).toBe(false);
    expect(errorResponse.safeParse({}).success).toBe(false);
  });
});
