import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type BuildAppOptions } from "../src/index.ts";
import { openFixture, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

const LIMITED = '{"message":"Muitas tentativas recusadas. Tente de novo em instantes."}';
const HOST = { host: "127.0.0.1:7777" };

async function open(options: Partial<BuildAppOptions> = {}): Promise<FastifyInstance> {
  f = openFixture();
  f.clock.now = 1000000;
  return buildApp(
    { ...f.deps, panelToken: "s3cret", now: () => f.clock.now },
    {
      attemptLimit: { maxFailures: 3, windowMs: 60000 },
      allowedHosts: () => ["127.0.0.1:7777"],
      allowedOrigins: ["http://ok.local"],
      ...options,
    },
  );
}

function status(app: FastifyInstance, token: string, extra: Record<string, string> = {}) {
  return app.inject({
    method: "GET",
    url: "/status?project=p1",
    headers: { ...HOST, "x-friday-token": token, ...extra },
  });
}

async function exhaust(app: FastifyInstance): Promise<void> {
  for (let i = 0; i < 3; i++) expect((await status(app, "errado")).statusCode).toBe(401);
}

describe("attempt limit", () => {
  it("answers 429 after the failure limit, even to a valid token", async () => {
    const app = await open();
    await exhaust(app);
    const res = await status(app, "errado");
    expect(res.statusCode).toBe(429);
    expect(res.body).toBe(LIMITED);
    expect(res.headers["retry-after"]).toBe("60");
    expect((await status(app, "s3cret")).statusCode).toBe(429);
  });

  it("keeps /health open while limited", async () => {
    const app = await open();
    await exhaust(app);
    const res = await app.inject({ method: "GET", url: "/health", headers: HOST });
    expect(res.statusCode).toBe(200);
  });

  it("starts a new window after windowMs", async () => {
    const app = await open();
    await exhaust(app);
    expect((await status(app, "s3cret")).statusCode).toBe(429);
    f.clock.now += 60000;
    expect((await status(app, "s3cret")).statusCode).toBe(200);
    f.clock.now += 60000;
    for (let i = 0; i < 3; i++) expect((await status(app, "errado")).statusCode).toBe(401);
    expect((await status(app, "errado")).statusCode).toBe(429);
  });

  it("counts 401 and 403 refusals and never counts successes", async () => {
    const app = await open();
    const evil = await app.inject({
      method: "GET",
      url: "/health",
      headers: { host: "evil.local" },
    });
    expect(evil.statusCode).toBe(403);
    const pre = await app.inject({
      method: "OPTIONS",
      url: "/status",
      headers: { ...HOST, origin: "http://outro.local" },
    });
    expect(pre.statusCode).toBe(403);
    expect((await status(app, "errado")).statusCode).toBe(401);
    expect((await status(app, "s3cret")).statusCode).toBe(429);

    const fresh = await open();
    for (let i = 0; i < 10; i++) expect((await status(fresh, "s3cret")).statusCode).toBe(200);
  });

  it("registers nothing without the attemptLimit option", async () => {
    const lines: string[] = [];
    f = openFixture();
    const app = await buildApp(
      { ...f.deps, panelToken: "s3cret", log: (m) => lines.push(m) },
      { allowedHosts: () => ["127.0.0.1:7777"] },
    );
    for (let i = 0; i < 25; i++) expect((await status(app, "errado")).statusCode).toBe(401);
    expect(lines).toEqual([]);
  });

  it("answers 429 with CORS headers for an allowed origin only", async () => {
    const app = await open();
    await exhaust(app);
    const ok = await status(app, "s3cret", { origin: "http://ok.local" });
    expect(ok.statusCode).toBe(429);
    expect(ok.headers["access-control-allow-origin"]).toBe("http://ok.local");
    expect(String(ok.headers.vary)).toContain("Origin");
    const other = await status(app, "s3cret", { origin: "http://outro.local" });
    expect(other.statusCode).toBe(429);
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    const pre = await app.inject({
      method: "OPTIONS",
      url: "/status",
      headers: { ...HOST, origin: "http://ok.local" },
    });
    expect(pre.statusCode).toBe(204);
  });
});
