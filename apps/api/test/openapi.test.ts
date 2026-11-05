import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { openFixture, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

const PATHS = [
  "/health",
  "/issues",
  "/issues/{issueId}/transitions",
  "/runs",
  "/runs/{runId}",
  "/ledger/days/{day}",
];

describe("GET /openapi.json", () => {
  it("documents get 200 on the six read paths and no write method", async () => {
    f = openFixture();
    const app = await buildApp(f.deps);
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json<{ openapi: string; paths: Record<string, Record<string, unknown>> }>();
    expect(doc.openapi.startsWith("3.")).toBe(true);
    for (const path of PATHS) {
      const item = doc.paths[path];
      expect(item, path).toBeDefined();
      const get = item!.get as { responses: Record<string, unknown> };
      expect(get.responses["200"], path).toBeDefined();
      for (const m of ["post", "put", "patch", "delete"]) expect(item![m], path).toBeUndefined();
    }
    await app.close();
  });
});
