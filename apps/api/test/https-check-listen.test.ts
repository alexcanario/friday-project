import { afterEach, describe, expect, it } from "vitest";
import { startApi } from "../src/index.ts";
import { openFixture, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

describe("startApi https", () => {
  it("startApi keeps loopback reachable over plain http", async () => {
    f = openFixture();
    const api = await startApi({ deps: f.deps, port: 0 });
    try {
      const res = await fetch(`http://127.0.0.1:${api.port}/health`);
      expect(res.status).toBe(200);
    } finally {
      await api.close();
    }
  });
});
