import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PORT, startApi } from "../src/index.ts";
import { openFixture, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

describe("startApi", () => {
  it("listens on 127.0.0.1 only, defaults to port 7777 and closes", async () => {
    f = openFixture();
    expect(DEFAULT_PORT).toBe(7777);
    // @ts-expect-error there is no host option: the API only listens on 127.0.0.1
    const api = await startApi({ deps: f.deps, port: 0, host: "0.0.0.0" });
    try {
      expect(api.address).toBe("127.0.0.1");
      expect(api.port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${api.port}/health`);
      expect(res.status).toBe(200);
    } finally {
      await api.close();
    }
    await expect(fetch(`http://127.0.0.1:${api.port}/health`)).rejects.toThrow();
  });
});
