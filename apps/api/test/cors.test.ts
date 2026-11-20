import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { openFixture, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

const ORIGIN = "http://painel.local";
const OTHER = "http://outro.local";

function corsHeaders(headers: Record<string, unknown>): string[] {
  return Object.keys(headers).filter((h) => h.startsWith("access-control-"));
}

describe("CORS by origin list", () => {
  it("allows the configured origin and answers the preflight without a token", async () => {
    f = openFixture();
    const app = await buildApp({ ...f.deps, panelToken: "s3cret" }, { allowedOrigins: [ORIGIN] });
    try {
      const health = await app.inject({
        method: "GET",
        url: "/health",
        headers: { origin: ORIGIN },
      });
      expect(health.statusCode).toBe(200);
      expect(health.headers["access-control-allow-origin"]).toBe(ORIGIN);
      expect(String(health.headers.vary)).toContain("Origin");

      const denied = await app.inject({
        method: "GET",
        url: "/status?project=p1",
        headers: { origin: ORIGIN },
      });
      expect(denied.statusCode).toBe(401);
      expect(denied.headers["access-control-allow-origin"]).toBe(ORIGIN);

      const preflight = await app.inject({
        method: "OPTIONS",
        url: "/status",
        headers: { origin: ORIGIN, "access-control-request-headers": "x-friday-token" },
      });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers["access-control-allow-origin"]).toBe(ORIGIN);
      expect(String(preflight.headers["access-control-allow-headers"])).toContain("x-friday-token");
      const methods = String(preflight.headers["access-control-allow-methods"]);
      expect(methods).toContain("GET");
      expect(methods).toContain("POST");
      expect(String(preflight.headers.vary)).toContain("Origin");
    } finally {
      await app.close();
    }
  });

  it("denies other origins, the wildcard and an empty list", async () => {
    f = openFixture();
    const app = await buildApp(f.deps, { allowedOrigins: [ORIGIN] });
    try {
      const other = await app.inject({
        method: "GET",
        url: "/health",
        headers: { origin: OTHER },
      });
      expect(other.statusCode).toBe(200);
      expect(corsHeaders(other.headers)).toEqual([]);
      expect(String(other.headers.vary)).toContain("Origin");

      const preflight = await app.inject({
        method: "OPTIONS",
        url: "/status",
        headers: { origin: OTHER, "access-control-request-headers": "x-friday-token" },
      });
      expect(preflight.statusCode).toBe(403);
      expect(corsHeaders(preflight.headers)).toEqual([]);

      const noOrigin = await app.inject({ method: "GET", url: "/health" });
      expect(corsHeaders(noOrigin.headers)).toEqual([]);
    } finally {
      await app.close();
    }
    for (const allowedOrigins of [["*"], [], undefined]) {
      const open = await buildApp(f.deps, { allowedOrigins });
      try {
        const res = await open.inject({
          method: "GET",
          url: "/health",
          headers: { origin: OTHER },
        });
        expect(corsHeaders(res.headers), JSON.stringify(allowedOrigins)).toEqual([]);
      } finally {
        await open.close();
      }
    }
  });
});
