import type { MergeResult } from "@friday/application";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp, type ApiDeps } from "../src/index.ts";
import { HEAD, openFixture, seedApproval, type Fixture } from "./helpers.ts";

let f: Fixture;
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  f.db.close();
});

const headers = { "x-friday-token": "s3cret" };

async function setup(opts: {
  head?: string | Error;
  merge?: { merged: true; sha: string } | { merged: false; reason: "not_mergeable" } | Error;
}) {
  f = openFixture();
  seedApproval(f);
  const squashMerge = vi.fn<(pr: number, sha: string) => Promise<MergeResult>>(async () => {
    const m = opts.merge ?? { merged: true as const, sha: "abc" };
    if (m instanceof Error) throw m;
    return m;
  });
  const readPrHead = vi.fn<(pr: number) => Promise<string>>(async () => {
    const h = opts.head ?? HEAD;
    if (h instanceof Error) throw h;
    return h;
  });
  const deps: ApiDeps = {
    ...f.deps,
    panelToken: "s3cret",
    github: { squashMerge },
    readPrHead,
  };
  app = await buildApp(deps);
  return { squashMerge, readPrHead };
}

const post = (action: "approve" | "deny", id = "00000001") =>
  app!.inject({ method: "POST", url: `/approvals/${id}/${action}`, headers });
const decided = () => f.deps.events.list("p1", 14).filter((e) => e.type === "ApprovalDecided");
const changes = () => f.deps.events.list("p1", 14).filter((e) => e.actor === "human:panel");

describe("POST /approvals/:id/approve and /deny", () => {
  it("approves and squash merges at the approved sha as human:panel, and returns 409 when the merge is blocked", async () => {
    const ok = await setup({});
    const res = await post("approve");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: "merged", sha: "abc" });
    expect(ok.squashMerge).toHaveBeenCalledTimes(1);
    expect(ok.squashMerge).toHaveBeenCalledWith(30, HEAD);
    expect(f.deps.approvals.get("00000001")?.decision).toBe("approved");
    expect(decided().map((e) => e.actor)).toEqual(["human:panel"]);
    await app!.close();
    f.db.close();

    await setup({ merge: { merged: false, reason: "not_mergeable" } });
    const blocked = await post("approve");
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ outcome: "merge_blocked" });
  });

  it("rejects with 409 when the head changed or the request expired and never merges", async () => {
    const changed = await setup({ head: "b".repeat(40) });
    const res = await post("approve");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ outcome: "head_changed" });
    expect(changed.squashMerge).not.toHaveBeenCalled();
    expect(f.deps.approvals.get("00000001")?.decision).toBeNull();
    await app!.close();
    f.db.close();

    const expired = await setup({});
    f.clock.now += 1_800_000;
    const late = await post("approve");
    expect(late.statusCode).toBe(409);
    expect(late.json()).toMatchObject({ outcome: "expired" });
    expect(expired.squashMerge).not.toHaveBeenCalled();
    expect(f.deps.approvals.get("00000001")?.decision).toBeNull();
  });

  it("denies, and maps unknown and already decided", async () => {
    const g = await setup({});
    const res = await post("deny");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: "denied" });
    expect(g.squashMerge).not.toHaveBeenCalled();
    expect(g.readPrHead).not.toHaveBeenCalled();
    expect(decided().map((e) => e.actor)).toEqual(["human:panel"]);

    const unknown = await post("deny", "nope");
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ outcome: "unknown" });

    const again = await post("deny");
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ outcome: "already_decided" });
  });

  it("records the state change as human:panel after deny and merge", async () => {
    await setup({});
    await post("deny");
    expect(changes().filter((e) => e.type === "StateChanged")).toHaveLength(1);
    expect(f.deps.issues.get("p1", 14)?.state).not.toBe("AwaitingApproval");
    await app!.close();
    f.db.close();

    await setup({});
    await post("approve");
    expect(changes().filter((e) => e.type === "StateChanged").length).toBeGreaterThan(0);
    expect(f.deps.issues.get("p1", 14)?.state).not.toBe("AwaitingApproval");
    const before = f.deps.events.list("p1", 14).length;
    await post("approve");
    await post("deny", "nope");
    expect(f.deps.events.list("p1", 14)).toHaveLength(before);
  });

  it("answers a fixed 502 without detail when github fails", async () => {
    await setup({ head: new Error("segredo-xyz") });
    const res = await post("approve");
    expect(res.statusCode).toBe(502);
    expect(res.body).toBe('{"error":"Falha ao consultar o GitHub."}');
    expect(res.body).not.toContain("segredo-xyz");
    expect(f.deps.approvals.get("00000001")?.decision).toBeNull();
    expect(f.deps.events.list("p1", 14).filter((e) => e.type === "ApprovalDecided")).toEqual([]);
    expect(changes()).toEqual([]);
    await app!.close();
    f.db.close();

    await setup({ merge: new Error("segredo-xyz") });
    const merge = await post("approve");
    expect(merge.statusCode).toBe(502);
    expect(merge.body).toBe('{"error":"Falha ao consultar o GitHub."}');
    expect(f.deps.approvals.get("00000001")?.decision).toBe("approved");
    expect(decided()).toHaveLength(1);
    expect(changes().filter((e) => e.type === "StateChanged")).toEqual([]);
  });
});
