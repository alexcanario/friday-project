import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { isLoopbackHostname } from "../src/https-check.ts";
import { openFixture, type Fixture } from "./helpers.ts";

const BODY = '{"message":"HTTPS obrigatório."}';
const HSTS = "strict-transport-security";

let f: Fixture;
afterEach(() => f.db.close());

async function appWith(requireHttps: boolean | undefined = true) {
  f = openFixture();
  return buildApp(f.deps, {
    allowedHosts: () => ["painel.exemplo.com", "127.0.0.1:7777"],
    requireHttps,
  });
}

describe("https check", () => {
  it("refuses anything outside loopback that is not marked https", async () => {
    const app = await appWith();
    const refused: Array<string | undefined> = ["http", "HTTP", "http, https", "https, http", ""];
    refused.push(undefined);
    for (const proto of refused) {
      const headers: Record<string, string> = { host: "painel.exemplo.com" };
      if (proto !== undefined) headers["x-forwarded-proto"] = proto;
      const res = await app.inject({ url: "/health", headers });
      expect(res.statusCode, String(proto)).toBe(403);
      expect(res.body, String(proto)).toBe(BODY);
    }
    for (const proto of ["https", "HTTPS, https"]) {
      const res = await app.inject({
        url: "/health",
        headers: { host: "painel.exemplo.com", "x-forwarded-proto": proto },
      });
      expect(res.statusCode, proto).toBe(200);
    }
    await app.close();
  });

  it("keeps loopback hosts open over http", async () => {
    const app = await appWith();
    for (const proto of ["http", undefined]) {
      const headers: Record<string, string> = { host: "127.0.0.1:7777" };
      if (proto !== undefined) headers["x-forwarded-proto"] = proto;
      const res = await app.inject({ url: "/health", headers });
      expect(res.statusCode, String(proto)).toBe(200);
    }
    for (const name of ["127.0.0.1", "localhost", "LOCALHOST", "[::1]"]) {
      expect(isLoopbackHostname(name), name).toBe(true);
    }
    for (const name of ["painel.exemplo.com", "127.0.0.2", ""]) {
      expect(isLoopbackHostname(name), name).toBe(false);
    }
    await app.close();
  });

  it("sets strict-transport-security only on accepted non-loopback responses", async () => {
    const app = await appWith();
    const ok = await app.inject({
      url: "/health",
      headers: { host: "painel.exemplo.com", "x-forwarded-proto": "https" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers[HSTS]).toBe("max-age=31536000");
    const loop = await app.inject({ url: "/health", headers: { host: "127.0.0.1:7777" } });
    expect(loop.statusCode).toBe(200);
    expect(loop.headers[HSTS]).toBeUndefined();
    const unknown = await app.inject({
      url: "/health",
      headers: { host: "evil.local", "x-forwarded-proto": "https" },
    });
    expect(unknown.statusCode).toBe(403);
    expect(unknown.headers[HSTS]).toBeUndefined();
    const plain = await app.inject({ url: "/health", headers: { host: "painel.exemplo.com" } });
    expect(plain.statusCode).toBe(403);
    expect(plain.headers[HSTS]).toBeUndefined();
    await app.close();
  });

  it("does nothing without the requireHttps option", async () => {
    const app = await appWith(undefined);
    const res = await app.inject({ url: "/health", headers: { host: "painel.exemplo.com" } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
