import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { streamCorsHeaders } from "../src/routes/events.ts";
import { openFixture, type Fixture } from "./helpers.ts";

const ORIGIN = "http://painel.local";
const OTHER = "http://outro.local";

let f: Fixture;
let app: FastifyInstance;
const ctrls: AbortController[] = [];

afterEach(async () => {
  for (const c of ctrls.splice(0)) c.abort();
  await app?.close();
  f.db.close();
});

async function boot(panelToken?: string): Promise<number> {
  f = openFixture();
  app = await buildApp({ ...f.deps, panelToken, ssePollMs: 20 }, { allowedOrigins: [ORIGIN] });
  await app.listen({ host: "127.0.0.1", port: 0 });
  return (app.server.address() as { port: number }).port;
}

async function openStream(port: number, headers: Record<string, string>): Promise<Response> {
  const ctrl = new AbortController();
  ctrls.push(ctrl);
  const res = await fetch(`http://127.0.0.1:${port}/events/stream?project=p1`, {
    headers,
    signal: ctrl.signal,
  });
  if (res.body) void res.body.cancel().catch(() => undefined);
  return res;
}

describe("GET /events/stream CORS", () => {
  it("stream 200 carries CORS headers only for allowed origins", async () => {
    const port = await boot();
    const ok = await openStream(port, { origin: ORIGIN });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/event-stream");
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(ok.headers.get("vary")).toContain("Origin");

    const other = await openStream(port, { origin: OTHER });
    expect(other.status).toBe(200);
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    expect(other.headers.get("vary")).toContain("Origin");

    const none = await openStream(port, {});
    expect(none.status).toBe(200);
    expect(none.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("passes only vary and access-control-allow-origin to the stream response", async () => {
    expect(
      streamCorsHeaders({
        vary: "Origin",
        "access-control-allow-origin": ORIGIN,
        "content-length": "5",
        "set-cookie": "a=1",
        "content-type": "application/json",
      }),
    ).toEqual({ vary: "Origin", "access-control-allow-origin": ORIGIN });
    expect(streamCorsHeaders({ "content-length": "5" })).toEqual({});

    const port = await boot();
    const res = await openStream(port, { origin: ORIGIN });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("content-length")).toBeNull();
  });

  it("stream keeps the token guard and CORS together", async () => {
    const port = await boot("s3cret");
    const denied = await openStream(port, { origin: ORIGIN });
    expect(denied.status).toBe(401);

    const ok = await openStream(port, { origin: ORIGIN, "x-friday-token": "s3cret" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/event-stream");
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(ok.headers.get("vary")).toContain("Origin");
  });

  it("preflight allows x-friday-token and last-event-id only for allowed origins", async () => {
    await boot();
    const ok = await app.inject({
      method: "OPTIONS",
      url: "/events/stream",
      headers: {
        origin: ORIGIN,
        "access-control-request-headers": "x-friday-token, last-event-id",
      },
    });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers["access-control-allow-origin"]).toBe(ORIGIN);
    const allowed = String(ok.headers["access-control-allow-headers"]);
    expect(allowed).toContain("x-friday-token");
    expect(allowed).toContain("last-event-id");

    const bad = await app.inject({
      method: "OPTIONS",
      url: "/events/stream",
      headers: { origin: OTHER, "access-control-request-headers": "x-friday-token, last-event-id" },
    });
    expect(bad.statusCode).toBe(403);
    expect(Object.keys(bad.headers).filter((h) => h.startsWith("access-control-"))).toEqual([]);
  });
});
