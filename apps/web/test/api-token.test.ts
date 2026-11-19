import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/api.ts";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

function stub(body: unknown, status = 200) {
  const fn = vi.fn(() => json(body, status));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("api client with token", () => {
  it("sends the token header only when there is a token", async () => {
    let fn = stub({ status: "ok" });
    await createApiClient("").fetchHealth();
    expect(fn.mock.calls[0]).toEqual(["/health"]);
    fn = stub({ status: "ok" });
    await createApiClient("", () => "s3cret").fetchHealth();
    expect(fn).toHaveBeenCalledWith("/health", { headers: { "x-friday-token": "s3cret" } });
    fn = stub({ status: "ok" });
    await createApiClient("", () => "").fetchHealth();
    expect(fn.mock.calls[0]).toEqual(["/health"]);
  });

  it("fetchProjects reads the projects and rejects HTTP 500 and invalid bodies", async () => {
    const client = createApiClient("http://h:1/", () => "t");
    const fn = stub([{ id: "a/b" }]);
    await expect(client.fetchProjects()).resolves.toEqual([{ id: "a/b" }]);
    expect(fn).toHaveBeenCalledWith("http://h:1/projects", {
      headers: { "x-friday-token": "t" },
    });
    stub([{ id: "a/b" }], 500);
    await expect(client.fetchProjects()).rejects.toThrow();
    stub([{ id: 1 }]);
    await expect(client.fetchProjects()).rejects.toThrow();
  });
});
