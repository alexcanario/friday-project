import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/api.ts";
import { ApiHttpError, ApiRedirectError, classifyHostError } from "../src/api-errors.ts";

afterEach(() => vi.unstubAllGlobals());

const redirect = (status: number) =>
  new Response(null, { status, headers: { location: "http://outro.local/" } });
const opaque = () =>
  ({ status: 0, type: "opaqueredirect", ok: false, body: null }) as unknown as Response;
const ok = (body: unknown) => new Response(JSON.stringify(body));

function stubWith(make: () => Response) {
  const fn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(make()),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

const redirects: Array<[string, () => Response, number]> = [
  ["301", () => redirect(301), 301],
  ["302", () => redirect(302), 302],
  ["307", () => redirect(307), 307],
  ["308", () => redirect(308), 308],
  ["opaqueredirect", opaque, 0],
];

describe("api client redirects", () => {
  it("sends redirect manual with and without a token", async () => {
    let fn = stubWith(() => ok({ status: "ok" }));
    await createApiClient("https://h:1", () => "tok").fetchHealth();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0]).toEqual([
      "https://h:1/health",
      { headers: { "x-friday-token": "tok" }, redirect: "manual" },
    ]);
    fn = stubWith(() => ok({ status: "ok" }));
    await createApiClient("").fetchHealth();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0]).toEqual(["/health", { redirect: "manual" }]);
    fn = stubWith(() => ok({ status: "ok" }));
    await createApiClient("", () => "").fetchHealth();
    expect(fn.mock.calls[0]).toEqual(["/health", { redirect: "manual" }]);
    fn = stubWith(() => ok({ status: "ok" }));
    await createApiClient("", () => "tok").fetchHealth();
    expect(fn.mock.calls[0]).toEqual([
      "/health",
      { headers: { "x-friday-token": "tok" }, redirect: "manual" },
    ]);
  });

  it("rejects a redirect on token-less reads without a second fetch", async () => {
    const client = createApiClient("");
    for (const [, make, status] of redirects) {
      const fn = stubWith(make);
      const res = make();
      const json = vi.fn();
      Object.assign(res, { json });
      fn.mockImplementation(() => Promise.resolve(res));
      const error: unknown = await client.fetchHealth().then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ApiRedirectError);
      expect((error as ApiRedirectError).status).toBe(status);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(json).not.toHaveBeenCalled();
    }
    stubWith(() => ok({ status: "ok" }));
    await expect(client.fetchHealth()).resolves.toEqual({ status: "ok" });
  });

  it("rejects a redirect response on reads without a second fetch", async () => {
    const client = createApiClient("https://h:1", () => "tok");
    for (const [, make, status] of redirects) {
      for (const call of [() => client.fetchHealth(), () => client.fetchProjects()]) {
        const fn = stubWith(make);
        const error: unknown = await call().then(
          () => null,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(ApiRedirectError);
        expect(error).toBeInstanceOf(ApiHttpError);
        expect((error as ApiRedirectError).status).toBe(status);
        expect((error as ApiRedirectError).message).toBe(
          "Falha ao consultar a API: a resposta foi um redirecionamento e não foi seguida",
        );
        expect(fn).toHaveBeenCalledTimes(1);
        expect(classifyHostError(error)).toBe("login");
      }
    }
    stubWith(() => ok({ status: "ok" }));
    await expect(client.fetchHealth()).resolves.toEqual({ status: "ok" });
    stubWith(() => new Response("{}", { status: 401 }));
    const unauthorized: unknown = await client.fetchHealth().catch((e: unknown) => e);
    expect(unauthorized).toBeInstanceOf(ApiHttpError);
    expect(unauthorized).not.toBeInstanceOf(ApiRedirectError);
    expect(classifyHostError(unauthorized)).toBe("unauthorized");
  });

  it("rejects a redirect response on postDecision and keeps non-2xx mapping", async () => {
    const client = createApiClient("", () => "tok");
    let fn = stubWith(() => ok({ outcome: "approved" }));
    await client.postDecision("a1", "approve");
    expect(fn).toHaveBeenCalledWith("/approvals/a1/approve", {
      method: "POST",
      headers: { "x-friday-token": "tok" },
      redirect: "manual",
    });
    fn = stubWith(() => ok({ outcome: "approved" }));
    await createApiClient("").postDecision("a1", "approve");
    expect(fn).toHaveBeenCalledWith("/approvals/a1/approve", {
      method: "POST",
      headers: {},
      redirect: "manual",
    });
    for (const make of [() => redirect(302), opaque]) {
      fn = stubWith(make);
      await expect(client.postDecision("a1", "approve")).rejects.toBeInstanceOf(ApiRedirectError);
      expect(fn).toHaveBeenCalledTimes(1);
    }
    stubWith(() => new Response(JSON.stringify({ outcome: "head_changed" }), { status: 409 }));
    await expect(client.postDecision("a1", "approve")).resolves.toEqual({
      status: 409,
      outcome: "head_changed",
    });
    stubWith(() => new Response("{}", { status: 401 }));
    await expect(client.postDecision("a1", "approve")).resolves.toEqual({
      status: 401,
      outcome: null,
    });
  });

  it("reads the token on every call", async () => {
    const getToken = vi.fn<() => string>().mockReturnValueOnce("a").mockReturnValueOnce("b");
    const fn = stubWith(() => ok({ status: "ok" }));
    const client = createApiClient("", getToken);
    await client.fetchHealth();
    await client.fetchHealth();
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls.map((c) => (c[1] as { headers: object }).headers)).toEqual([
      { "x-friday-token": "a" },
      { "x-friday-token": "b" },
    ]);

    const second = vi.fn<() => string>().mockReturnValueOnce("a").mockReturnValueOnce("");
    const fn2 = stubWith(() => ok({ status: "ok" }));
    const client2 = createApiClient("", second);
    await client2.fetchHealth();
    await client2.fetchHealth();
    expect(fn2.mock.calls[1]).toEqual(["/health", { redirect: "manual" }]);

    const third = vi.fn<() => string>().mockReturnValue("t");
    stubWith(() => ok({ outcome: "approved" }));
    const client3 = createApiClient("", third);
    await client3.postDecision("a1", "approve");
    await client3.postDecision("a1", "deny");
    expect(third).toHaveBeenCalledTimes(2);
  });
});
