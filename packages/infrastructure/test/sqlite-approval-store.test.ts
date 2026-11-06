import type { ApprovalRecord } from "@friday/application";
import { describe, expect, it } from "vitest";
import { createApprovalStore, generateApprovalId } from "../src/index.ts";
import { openWithProjects } from "./sqlite-fixtures.ts";

const rec = (over: Partial<ApprovalRecord>): ApprovalRecord => ({
  id: "00000001",
  projectId: "p1",
  issueId: 7,
  pr: 30,
  headSha: "a".repeat(40),
  tier: "high",
  requestedAt: 1000,
  expiresAt: 5000,
  decision: null,
  decidedAt: null,
  decidedBy: null,
  ...over,
});

describe("sqlite approval store", () => {
  it("stores, lists pending, decides once and generates 8 hex ids", () => {
    const store = createApprovalStore(openWithProjects("p1", "p2"));
    const first = rec({ id: "00000002", requestedAt: 1000 });
    store.insert(first);
    expect(store.get("00000002")).toEqual(first);
    expect(() => store.insert(first)).toThrow();
    expect(store.get("inexistente")).toBeNull();

    store.insert(rec({ id: "00000001", requestedAt: 1000 }));
    store.insert(rec({ id: "00000003", requestedAt: 500 }));
    store.insert(rec({ id: "00000004", requestedAt: 900, expiresAt: 2000 }));
    store.insert(rec({ id: "00000005", projectId: "p2" }));
    store.insert(rec({ id: "00000006", requestedAt: 100 }));
    expect(
      store.decide("00000006", { decision: "denied", decidedAt: 200, decidedBy: "human:cli" }),
    ).toBe(true);

    expect(store.listPending("p1", 1500).map((r) => r.id)).toEqual([
      "00000003",
      "00000004",
      "00000001",
      "00000002",
    ]);
    expect(store.listPending("p1", 2000).map((r) => r.id)).toEqual([
      "00000003",
      "00000001",
      "00000002",
    ]);

    const d1 = { decision: "approved", decidedAt: 1200, decidedBy: "human:cli" } as const;
    expect(store.decide("00000001", d1)).toBe(true);
    expect(
      store.decide("00000001", { decision: "denied", decidedAt: 1300, decidedBy: "outro" }),
    ).toBe(false);
    expect(store.get("00000001")).toMatchObject({
      decision: "approved",
      decidedAt: 1200,
      decidedBy: "human:cli",
    });

    for (let i = 0; i < 50; i++) expect(generateApprovalId()).toMatch(/^[0-9a-f]{8}$/);
  });
});
