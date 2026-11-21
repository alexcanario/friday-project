import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { openFixture, type Fixture } from "./helpers.ts";

let f: Fixture;
let app: FastifyInstance;

const ORIGIN = "https://panel.example.com";
const BASE = { host: "panel.example.com", "x-forwarded-proto": "https" };

beforeEach(async () => {
  f = openFixture();
  app = await buildApp(
    { ...f.deps, panelToken: "s3cret", now: () => f.clock.now },
    {
      allowedHosts: () => ["panel.example.com"],
      requireHttps: true,
      allowedOrigins: [ORIGIN],
      attemptLimit: { maxFailures: 2, windowMs: 60000 },
    },
  );
  for (let i = 0; i < 2; i += 1) {
    const res = await app.inject({ method: "GET", url: "/runs?project=p1", headers: BASE });
    expect(res.statusCode).toBe(401);
  }
});

afterEach(async () => {
  await app.close();
  f.db.close();
});

describe("preflight when the attempt limit is reached", () => {
  describe("C1", () => {
    it("preflight from a listed origin gets 204 at the limit", async () => {
      const res = await app.inject({
        method: "OPTIONS",
        url: "/runs?project=p1",
        headers: { ...BASE, origin: ORIGIN },
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
      expect(res.headers["retry-after"]).toBeUndefined();
    });
  });

  describe("C2", () => {
    it("preflight from an unlisted origin gets 403 at the limit", async () => {
      const res = await app.inject({
        method: "OPTIONS",
        url: "/runs?project=p1",
        headers: { ...BASE, origin: "https://evil.example.com" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ message: "Origem não permitida." });
      expect(res.headers["retry-after"]).toBeUndefined();
    });
  });

  describe("C3", () => {
    it("OPTIONS without Origin and GET get 429 at the limit", async () => {
      const options = await app.inject({
        method: "OPTIONS",
        url: "/runs?project=p1",
        headers: BASE,
      });
      expect(options.statusCode).toBe(429);
      const get = await app.inject({ method: "GET", url: "/runs?project=p1", headers: BASE });
      expect(get.statusCode).toBe(429);
      expect(get.headers["retry-after"]).toBe("60");
    });
  });

  describe("C4", () => {
    it("health stays 200 at the limit", async () => {
      const res = await app.inject({ method: "GET", url: "/health", headers: BASE });
      expect(res.statusCode).toBe(200);
    });
  });
});
