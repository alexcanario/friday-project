import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { openFixture, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    f = openFixture();
    const app = await buildApp(f.deps);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"status":"ok"}');
    await app.close();
  });
});
