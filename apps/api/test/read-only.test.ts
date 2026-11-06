import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { countRows, openFixture, seedIssues, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

describe("read-only API", () => {
  it("leaves events, runs and ledger rows unchanged and rejects write methods with 404", async () => {
    f = openFixture();
    seedIssues(f);
    const app = await buildApp(f.deps);
    const eventsBefore = f.deps.events.list("p1", 14);
    const countsBefore = countRows(f.db);
    for (const url of [
      "/health",
      "/issues?project=p1",
      "/issues/14/transitions?project=p1",
      "/runs?project=p1",
      "/runs/nope?project=p1",
      "/ledger/days/2026-11-05?project=p1",
      "/openapi.json",
    ]) {
      await app.inject({ method: "GET", url });
    }
    expect(f.deps.events.list("p1", 14)).toEqual(eventsBefore);
    expect(countRows(f.db)).toEqual(countsBefore);

    for (const [method, url] of [
      ["POST", "/issues"],
      ["PUT", "/issues"],
      ["DELETE", "/issues/14"],
    ] as const) {
      const res = await app.inject({ method, url, payload: method === "DELETE" ? undefined : {} });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    expect(countRows(f.db)).toEqual(countsBefore);
    await app.close();
  });
});
