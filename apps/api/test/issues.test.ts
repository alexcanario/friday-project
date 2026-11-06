import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { openFixture, stateChanged, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

describe("GET /issues", () => {
  it("lists issues of a project in issueId order, returns [] for an empty one and 400 without project", async () => {
    f = openFixture();
    f.deps.events.append(stateChanged("p1", 14, "Todo", "InProgress"));
    f.deps.events.append(stateChanged("p1", 13, "Backlog", "Todo"));
    f.deps.issues.rebuild("p1");
    const app = await buildApp(f.deps);
    const res = await app.inject({ method: "GET", url: "/issues?project=p1" });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<Record<string, unknown>>>();
    expect(body).toHaveLength(2);
    expect(body.map((i) => i.issueId)).toEqual([13, 14]);
    for (const item of body) {
      expect(Object.keys(item).sort()).toEqual(["heldReason", "issueId", "state"]);
    }
    expect(body[0]).toEqual({ issueId: 13, state: "Todo", heldReason: null });
    expect(body[1]).toEqual({ issueId: 14, state: "InProgress", heldReason: null });

    const empty = await app.inject({ method: "GET", url: "/issues?project=p2" });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual([]);

    expect((await app.inject({ method: "GET", url: "/issues" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/issues?project=" })).statusCode).toBe(400);
    await app.close();
  });
});
