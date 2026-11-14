import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/api.ts";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: () => Promise<unknown>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("api client", () => {
  it("createApiClient builds the health URL from the base and rejects bad responses", async () => {
    const cases: Array<[string, string]> = [
      ["", "/health"],
      ["http://h:7777", "http://h:7777/health"],
      ["http://h:7777/", "http://h:7777/health"],
    ];
    for (const [base, url] of cases) {
      const fn = stubFetch(() => json({ status: "ok" }));
      await expect(createApiClient(base).fetchHealth()).resolves.toEqual({ status: "ok" });
      expect(fn).toHaveBeenCalledWith(url);
    }
    const client = createApiClient("");
    stubFetch(() => json({ status: "down" }));
    await expect(client.fetchHealth()).rejects.toThrow();
    stubFetch(() => json({ status: "ok" }, 500));
    await expect(client.fetchHealth()).rejects.toThrow();
    stubFetch(() => Promise.reject(new TypeError("network")));
    await expect(client.fetchHealth()).rejects.toThrow();
  });
});
