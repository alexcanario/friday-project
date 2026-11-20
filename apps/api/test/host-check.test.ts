import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { allowedHostsOf, isHostAllowed } from "../src/host-check.ts";
import { openFixture, type Fixture } from "./helpers.ts";

const ALLOWED = ["127.0.0.1:7777", "localhost:7777", "painel.exemplo.com"];
const BODY = '{"message":"Host não permitido."}';

let f: Fixture;
afterEach(() => f.db.close());

async function appWith(options: Parameters<typeof buildApp>[1] = {}) {
  f = openFixture();
  return buildApp(f.deps, { allowedHosts: () => ALLOWED, ...options });
}

function noCors(headers: Record<string, unknown>): string[] {
  return Object.keys(headers).filter((h) => h.startsWith("access-control-"));
}

describe("host check", () => {
  it("registers no check when allowedHosts is omitted", async () => {
    f = openFixture();
    const app = await buildApp(f.deps);
    const res = await app.inject({ url: "/health", headers: { host: "qualquer.local" } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("builds the accepted names from the port and the origins", () => {
    const origins = [
      "http://painel.exemplo.com",
      "https://seguro.exemplo.com:8443",
      "null",
      "*",
      "lixo",
    ];
    expect(allowedHostsOf(7777, origins)).toEqual([
      "127.0.0.1:7777",
      "localhost:7777",
      "painel.exemplo.com",
      "seguro.exemplo.com:8443",
    ]);
  });

  it("accepts loopback with the port, any case, and a listed origin host", async () => {
    const app = await appWith();
    for (const host of ["127.0.0.1:7777", "LOCALHOST:7777", "painel.exemplo.com"]) {
      const res = await app.inject({ url: "/health", headers: { host } });
      expect(res.statusCode, host).toBe(200);
    }
    await app.close();
  });

  it("refuses unknown, portless, ipv6 and malformed hosts with a fixed 403", async () => {
    const app = await appWith();
    const bad = [
      "evil.local",
      "127.0.0.1",
      "127.0.0.1:7778",
      "[::1]:7777",
      "localhost.:7777",
      "painel.exemplo.com:80",
      "127.0.0.1:7777, evil.local",
    ];
    for (const host of bad) {
      const res = await app.inject({ url: "/health", headers: { host } });
      expect(res.statusCode, host).toBe(403);
      expect(res.body, host).toBe(BODY);
      expect(noCors(res.headers), host).toEqual([]);
    }
    expect(isHostAllowed(undefined, ALLOWED)).toBe(false);
    expect(isHostAllowed("", ALLOWED)).toBe(false);
    expect(isHostAllowed(["127.0.0.1:7777"], ALLOWED)).toBe(false);
    await app.close();
  });

  it("guards health, api, openapi, static and 404 alike", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), "friday-web-"));
    writeFileSync(join(webRoot, "index.html"), "<html></html>");
    const app = await appWith({ webRoot });
    for (const url of [
      "/health",
      "/status?project=p1",
      "/openapi.json",
      "/",
      "/rota-inexistente",
    ]) {
      const res = await app.inject({ url, headers: { host: "evil.local" } });
      expect(res.statusCode, url).toBe(403);
      expect(res.body, url).toBe(BODY);
    }
    const ok = { host: "127.0.0.1:7777" };
    expect((await app.inject({ url: "/", headers: ok })).statusCode).toBe(200);
    expect((await app.inject({ url: "/rota-inexistente", headers: ok })).statusCode).toBe(404);
    await app.close();
  });

  it("runs before cors and the token guard", async () => {
    f = openFixture();
    f.deps.panelToken = "s3cret";
    const origin = "http://painel.exemplo.com";
    const app = await buildApp(f.deps, { allowedHosts: () => ALLOWED, allowedOrigins: [origin] });
    const get = await app.inject({
      url: "/status?project=p1",
      headers: { host: "evil.local", origin },
    });
    expect(get.statusCode).toBe(403);
    expect(get.headers.vary).toBeUndefined();
    expect(noCors(get.headers)).toEqual([]);
    const options = await app.inject({
      method: "OPTIONS",
      url: "/status",
      headers: { host: "evil.local", origin },
    });
    expect(options.statusCode).toBe(403);
    expect(options.body).toBe(BODY);
    const noToken = await app.inject({
      url: "/status?project=p1",
      headers: { host: "127.0.0.1:7777", origin },
    });
    expect(noToken.statusCode).toBe(401);
    await app.close();
  });

  it("never reads x-forwarded-host", async () => {
    const app = await appWith();
    const evil = await app.inject({
      url: "/health",
      headers: { host: "evil.local", "x-forwarded-host": "127.0.0.1:7777" },
    });
    expect(evil.statusCode).toBe(403);
    const good = await app.inject({
      url: "/health",
      headers: { host: "127.0.0.1:7777", "x-forwarded-host": "evil.local" },
    });
    expect(good.statusCode).toBe(200);
    await app.close();
  });
});
