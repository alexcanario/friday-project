import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/api.ts";
import { ApiInsecureError } from "../src/api-errors.ts";
import { liveTarget } from "../src/live-target.ts";
import { isInsecureBase } from "../src/secure-base.ts";

afterEach(() => vi.unstubAllGlobals());

const BAD = "http://painel.exemplo.com";

describe("secure base", () => {
  it("flags http outside loopback only and judges a non-URL base by the page", () => {
    expect(isInsecureBase(BAD, undefined)).toBe(true);
    for (const ok of [
      "https://painel.exemplo.com",
      "http://127.0.0.1:7778",
      "http://localhost:7778",
      "http://[::1]:7778",
    ]) {
      expect(isInsecureBase(ok, undefined)).toBe(false);
    }
    const http = { protocol: "http:", hostname: "painel.exemplo.com" };
    const https = { protocol: "https:", hostname: "painel.exemplo.com" };
    const local = { protocol: "http:", hostname: "localhost" };
    for (const base of ["", "::", "/api", "api"]) {
      expect(isInsecureBase(base, http)).toBe(true);
      expect(isInsecureBase(base, https)).toBe(false);
      expect(isInsecureBase(base, local)).toBe(false);
      expect(isInsecureBase(base, undefined)).toBe(false);
    }
    expect(isInsecureBase("http:", https)).toBe(true);
    for (const ok of ["http://127.0.0.1:7777", "http://localhost:7777", "http://[::1]:7777"]) {
      expect(isInsecureBase(ok, undefined)).toBe(false);
    }
    for (const bad of [
      "http:painel.exemplo.com",
      "http:\\\\painel.exemplo.com",
      " http://painel.exemplo.com",
    ]) {
      expect(isInsecureBase(bad, undefined)).toBe(true);
    }
  });

  it("flags a base without protocol whatever the page", () => {
    for (const base of [
      "//host.remoto",
      "//host.remoto:7777",
      "\\\\host.remoto",
      "/\\host.remoto",
      "\\/host.remoto",
      "  //host.remoto",
      "/\t/host.remoto",
      "//",
      "http:",
      "http:/",
      "https:",
    ]) {
      expect(isInsecureBase(base, undefined)).toBe(true);
    }
    const local = { protocol: "http:", hostname: "localhost" };
    const https = { protocol: "https:", hostname: "painel.exemplo.com" };
    expect(isInsecureBase("//host.remoto", local)).toBe(true);
    expect(isInsecureBase("//host.remoto", https)).toBe(true);
  });

  it("flags a base that becomes protocol-relative once the path is appended", async () => {
    for (const base of ["/", "\\", "/\t", "/\n", " \\", "\\\t"]) {
      expect(isInsecureBase(base, undefined)).toBe(true);
    }
    // Whitespace-only bases resolve against the page (" /health"), so the page decides.
    const http = { protocol: "http:", hostname: "painel.exemplo.com" };
    const local = { protocol: "http:", hostname: "localhost" };
    for (const base of [" ", "\t"]) {
      expect(isInsecureBase(base, undefined)).toBe(false);
      expect(isInsecureBase(base, local)).toBe(false);
      expect(isInsecureBase(base, http)).toBe(true);
    }
    vi.stubGlobal("location", local);
    const fn = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fn);
    await expect(createApiClient("\\", () => "tok").fetchHealth()).rejects.toBeInstanceOf(
      ApiInsecureError,
    );
    expect(fn).toHaveBeenCalledTimes(0);
    vi.stubGlobal("sessionStorage", { getItem: () => "tok", setItem: () => undefined });
    expect(
      liveTarget({ kind: "selected", host: { name: "h1", baseUrl: "/" }, project: "o/r" }),
    ).toBeNull();
  });

  it("never sends the token to a protocol-relative base", async () => {
    vi.stubGlobal("location", { protocol: "http:", hostname: "localhost" });
    const fn = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ status: "ok" }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fn);
    const client = createApiClient("//host.remoto", () => "tok");
    await expect(client.fetchHealth()).rejects.toBeInstanceOf(ApiInsecureError);
    await expect(client.postDecision("a1", "approve")).rejects.toBeInstanceOf(ApiInsecureError);
    expect(fn).toHaveBeenCalledTimes(0);

    await createApiClient("//host.remoto", () => "").fetchHealth();
    expect(fn).toHaveBeenCalledTimes(1);

    const fn2 = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ status: "ok" }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fn2);
    await createApiClient("", () => "tok").fetchHealth();
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledWith(
      "/health",
      expect.objectContaining({
        headers: { "x-friday-token": "tok" },
        redirect: "manual",
      }),
    );
  });

  it("opens no live stream to a protocol-relative base", () => {
    vi.stubGlobal("location", { protocol: "http:", hostname: "localhost" });
    vi.stubGlobal("sessionStorage", {
      getItem: () => "tok",
      setItem: () => undefined,
    });
    const target = (baseUrl: string) =>
      liveTarget({ kind: "selected", host: { name: "h1", baseUrl }, project: "o/r" });
    expect(target("//host.remoto")).toBeNull();
    expect(target("http://localhost:7777")).toEqual({
      baseUrl: "http://localhost:7777",
      project: "o/r",
      token: "tok",
      host: "h1",
    });
  });

  it("never sends the token to an insecure host", async () => {
    const fn = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ status: "ok" }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fn);
    const client = createApiClient(BAD, () => "tok");
    await expect(client.fetchHealth()).rejects.toBeInstanceOf(ApiInsecureError);
    await expect(client.postDecision("a1", "approve")).rejects.toBeInstanceOf(ApiInsecureError);
    expect(fn).toHaveBeenCalledTimes(0);

    await createApiClient(BAD, () => "").fetchHealth();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0]).toEqual([`${BAD}/health`, { redirect: "manual" }]);

    await createApiClient("https://painel.exemplo.com", () => "tok").fetchHealth();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("opens no live stream to an insecure host", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => "tok",
      setItem: () => undefined,
    });
    const target = (baseUrl: string) =>
      liveTarget({ kind: "selected", host: { name: "h1", baseUrl }, project: "o/r" });
    expect(target(BAD)).toBeNull();
    expect(target("https://painel.exemplo.com")).toEqual({
      baseUrl: "https://painel.exemplo.com",
      project: "o/r",
      token: "tok",
      host: "h1",
    });
    expect(target("http://127.0.0.1:7778")).toEqual({
      baseUrl: "http://127.0.0.1:7778",
      project: "o/r",
      token: "tok",
      host: "h1",
    });
  });
});
