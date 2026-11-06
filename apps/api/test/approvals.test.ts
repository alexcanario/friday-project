import type { ApprovalRecord } from "@friday/application";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { openFixture } from "./helpers.ts";

const A = "a".repeat(40);
const T0 = 1_000_000;

function record(over: Partial<ApprovalRecord> & Pick<ApprovalRecord, "id">): ApprovalRecord {
  const requestedAt = over.requestedAt ?? T0;
  return {
    projectId: "p1",
    issueId: 7,
    pr: 30,
    headSha: A,
    tier: "high",
    requestedAt,
    expiresAt: requestedAt + 1_800_000,
    decision: null,
    decidedAt: null,
    decidedBy: null,
    ...over,
  };
}

describe("GET /approvals", () => {
  it("lists only the pending approvals of the project in order and excludes expired and decided ones", async () => {
    const f = openFixture();
    f.deps.approvals.insert(record({ id: "00000001" }));
    f.deps.approvals.insert(record({ id: "00000002", requestedAt: T0 + 1000, issueId: 8, pr: 31 }));
    f.deps.approvals.insert(record({ id: "00000003", projectId: "p2", issueId: 10, pr: 33 }));
    f.deps.approvals.insert(
      record({
        id: "00000004",
        requestedAt: T0 + 500,
        issueId: 9,
        pr: 32,
        decision: "denied",
        decidedAt: T0 + 600,
        decidedBy: "human:cli",
      }),
    );
    const app = await buildApp(f.deps);
    f.clock.now = T0 + 2000;
    const res = await app.inject({ method: "GET", url: "/approvals?project=p1" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        id: "00000001",
        issueId: 7,
        pr: 30,
        headSha: A,
        tier: "high",
        requestedAt: T0,
        expiresAt: T0 + 1_800_000,
      },
      {
        id: "00000002",
        issueId: 8,
        pr: 31,
        headSha: A,
        tier: "high",
        requestedAt: T0 + 1000,
        expiresAt: T0 + 1_801_000,
      },
    ]);
    f.clock.now = T0 + 1_800_000;
    const later = await app.inject({ method: "GET", url: "/approvals?project=p1" });
    expect(later.json().map((a: { id: string }) => a.id)).toEqual(["00000002"]);
    f.clock.now = T0 + 2000;
    const p2 = await app.inject({ method: "GET", url: "/approvals?project=p2" });
    expect(p2.json().map((a: { id: string }) => a.id)).toEqual(["00000003"]);
  });

  it("answers an empty list and 400 without a project", async () => {
    const f = openFixture();
    const app = await buildApp(f.deps);
    const empty = await app.inject({ method: "GET", url: "/approvals?project=p1" });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/approvals" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/approvals?project=" })).statusCode).toBe(400);
  });

  it("serializes the unclassified tier", async () => {
    const f = openFixture();
    f.deps.approvals.insert(record({ id: "00000001", tier: "unclassified" }));
    const app = await buildApp(f.deps);
    const res = await app.inject({ method: "GET", url: "/approvals?project=p1" });
    expect(res.json()[0].tier).toBe("unclassified");
  });

  it("documents only GET /approvals and exposes no write route", async () => {
    const f = openFixture();
    f.deps.approvals.insert(record({ id: "00000001" }));
    const app = await buildApp(f.deps);
    const spec = (await app.inject({ method: "GET", url: "/openapi.json" })).json();
    const item = spec.paths["/approvals"];
    expect(item.get.responses["200"]).toBeDefined();
    for (const m of ["post", "put", "patch", "delete"]) expect(item[m]).toBeUndefined();
    expect(Object.keys(spec.paths).filter((p) => p.startsWith("/approvals/"))).toEqual([]);
    expect((await app.inject({ method: "POST", url: "/approvals" })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: "POST", url: "/approvals/00000001/approve" })).statusCode,
    ).toBe(404);
    expect(f.deps.approvals.get("00000001")?.decision).toBeNull();
  });
});
