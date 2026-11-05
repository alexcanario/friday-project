import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { openFixture, seedIssues, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

describe("GET /issues/:issueId/transitions", () => {
  it("returns only StateChanged items with the exact shape in seq order, 404 for an unknown issue, 400 for a non-numeric id or missing project", async () => {
    f = openFixture();
    seedIssues(f);
    const app = await buildApp(f.deps);
    const res = await app.inject({ method: "GET", url: "/issues/14/transitions?project=p1" });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<Record<string, unknown>>>();
    const stored = f.deps.events.list("p1", 14).filter((e) => e.type === "StateChanged");
    expect(stored).toHaveLength(2);
    expect(body).toHaveLength(2);
    expect(body.map((i) => i.seq)).toEqual(stored.map((e) => e.seq));
    expect(body[0]!.seq as number).toBeLessThan(body[1]!.seq as number);
    for (const [i, item] of body.entries()) {
      expect(Object.keys(item).sort()).toEqual(
        ["actor", "at", "from", "heldReason", "runId", "seq", "to", "trigger"].sort(),
      );
      const e = stored[i]!;
      const p = e.payload as { from: string; to: string; trigger: string; heldReason: string };
      expect(item).toEqual({
        seq: e.seq,
        at: e.at,
        actor: e.actor,
        runId: e.runId,
        from: p.from,
        to: p.to,
        trigger: p.trigger,
        heldReason: p.heldReason,
      });
    }
    expect(body.some((i) => i.heldReason !== null)).toBe(true);

    const unknown = await app.inject({ method: "GET", url: "/issues/99/transitions?project=p1" });
    expect(unknown.statusCode).toBe(404);
    const bad = await app.inject({ method: "GET", url: "/issues/abc/transitions?project=p1" });
    expect(bad.statusCode).toBe(400);
    const noProject = await app.inject({ method: "GET", url: "/issues/14/transitions" });
    expect(noProject.statusCode).toBe(400);
    await app.close();
  });
});
