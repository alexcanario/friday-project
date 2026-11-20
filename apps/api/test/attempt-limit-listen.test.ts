import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ATTEMPT_LIMIT, startApi } from "../src/index.ts";
import { openFixture, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

describe("startApi attempt limit", () => {
  it("startApi enables the default limit", async () => {
    f = openFixture();
    expect(DEFAULT_ATTEMPT_LIMIT).toEqual({ maxFailures: 10, windowMs: 60000 });
    const api = await startApi({ deps: { ...f.deps, panelToken: "s3cret" }, port: 0 });
    try {
      const url = `http://127.0.0.1:${api.port}/status?project=p1`;
      const headers = { "x-friday-token": "errado" };
      for (let i = 0; i < 10; i++) expect((await fetch(url, { headers })).status).toBe(401);
      expect((await fetch(url, { headers })).status).toBe(429);
    } finally {
      await api.close();
    }
  });
});
