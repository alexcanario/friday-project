import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { openFixture, type Fixture } from "./helpers.ts";

const LISTED = "http://localhost:5173";

let f: Fixture;
let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
  f.db.close();
});

async function boot(allowedOrigins: string[]): Promise<void> {
  f = openFixture();
  app = await buildApp(f.deps, { allowedOrigins });
}

const corsKeys = (headers: Record<string, unknown>): string[] =>
  Object.keys(headers).filter((h) => h.startsWith("access-control-"));

describe("CORS hardening", () => {
  it("never allows the null origin even when listed", async () => {
    await boot(["null", LISTED]);
    const pre = await app.inject({
      method: "OPTIONS",
      url: "/status",
      headers: { origin: "null" },
    });
    expect(pre.statusCode).toBe(403);
    expect(pre.body).toBe('{"message":"Origem não permitida."}');
    expect(corsKeys(pre.headers)).toEqual([]);

    const read = await app.inject({ method: "GET", url: "/health", headers: { origin: "null" } });
    expect(read.statusCode).toBe(200);
    expect(read.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("still allows a listed origin next to a listed null", async () => {
    await boot(["null", LISTED]);
    const res = await app.inject({
      method: "OPTIONS",
      url: "/status",
      headers: { origin: LISTED },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(LISTED);
  });

  it("sets vary Origin on the 403 preflight", async () => {
    await boot([LISTED]);
    const res = await app.inject({
      method: "OPTIONS",
      url: "/status",
      headers: { origin: "http://outro.local" },
    });
    expect(res.statusCode).toBe(403);
    expect(String(res.headers.vary)).toContain("Origin");
  });

  it("rejects the * origin on OPTIONS and on reads", async () => {
    await boot(["*"]);
    const pre = await app.inject({ method: "OPTIONS", url: "/status", headers: { origin: "*" } });
    expect(pre.statusCode).toBe(403);
    expect(pre.headers["access-control-allow-origin"]).toBeUndefined();

    const read = await app.inject({ method: "GET", url: "/health", headers: { origin: "*" } });
    expect(read.statusCode).toBe(200);
    expect(read.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
