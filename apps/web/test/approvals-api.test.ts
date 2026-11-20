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

const item = { id: "a1", issueId: 14, pr: 5, headSha: "abc123", tier: "low", requestedAt: 1, expiresAt: 2 };
const status = { enabled: null, breaker: { open: false, openedAt: null, failures: [] } };

describe("approvals api", () => {
  it("fetches approvals and status by project and rejects HTTP 500 and invalid payloads", async () => {
    let fn = stub([item]);
    await expect(createApiClient("", () => "t").fetchApprovals("p 1")).resolves.toEqual([item]);
    expect(fn).toHaveBeenCalledWith("/approvals?project=p%201", {
      headers: { "x-friday-token": "t" },
    });
    fn = stub(status);
    await expect(createApiClient("http://h:1/").fetchStatus("p1")).resolves.toEqual(status);
    expect(fn.mock.calls[0]).toEqual(["http://h:1/status?project=p1"]);
    const client = createApiClient("", () => "t");
    stub([item], 500);
    await expect(client.fetchApprovals("p")).rejects.toMatchObject({ status: 500 });
    stub(status, 500);
    await expect(client.fetchStatus("p")).rejects.toMatchObject({ status: 500 });
    stub([{ id: 1 }]);
    await expect(client.fetchApprovals("p")).rejects.toThrow();
    stub({ enabled: "yes" });
    await expect(client.fetchStatus("p")).rejects.toThrow();
  });

  it("posts the decision without body or content-type and maps non-2xx without throwing", async () => {
    const client = createApiClient("", () => "s3cret");
    let fn = stub({ outcome: "merged" });
    await client.postDecision("a1", "approve");
    expect(fn).toHaveBeenCalledWith(
      "/approvals/a1/approve",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-friday-token": "s3cret" }),
      }),
    );
    const init = (fn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init as { body?: unknown }).body).toBeUndefined();
    expect(Object.keys(init.headers as object)).toEqual(["x-friday-token"]);
    fn = stub({ outcome: "denied" });
    await client.postDecision("a1", "deny");
    expect(fn.mock.calls[0]?.[0]).toBe("/approvals/a1/deny");
    stub({ outcome: "head_changed" }, 409);
    await expect(client.postDecision("a1", "approve")).resolves.toEqual({
      status: 409,
      outcome: "head_changed",
    });
    stub({ message: "x" }, 401);
    await expect(client.postDecision("a1", "approve")).resolves.toEqual({
      status: 401,
      outcome: null,
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", { status: 401 }))));
    await expect(client.postDecision("a1", "approve")).resolves.toEqual({
      status: 401,
      outcome: null,
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("net"))));
    await expect(client.postDecision("a1", "approve")).rejects.toThrow("net");
  });
});
