import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { openFixture, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

const HOST = { host: "127.0.0.1:7777" };

async function open(log: (m: string) => void): Promise<FastifyInstance> {
  f = openFixture();
  f.clock.now = 1000000;
  return buildApp(
    { ...f.deps, panelToken: "s3cret", now: () => f.clock.now, log },
    {
      attemptLimit: { maxFailures: 3, windowMs: 60000 },
      allowedHosts: () => ["127.0.0.1:7777"],
      allowedOrigins: ["http://ok.local"],
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

const evil = (app: FastifyInstance) =>
  app.inject({ method: "GET", url: "/health", headers: { host: "evil.local" } });

describe("attempt limit log", () => {
  it("logs one safe line per refusal", async () => {
    const lines: string[] = [];
    const app = await open((m) => lines.push(m));
    await status(app, "errado-123", { origin: "http://ok.local" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual({
      level: "warn",
      msg: "request refused",
      status: 401,
      method: "GET",
      path: "/status",
      host: "127.0.0.1:7777",
      origin: "http://ok.local",
    });
    await status(app, "errado-123");
    expect(JSON.parse(lines[1] as string).origin).toBeNull();
    const text = lines.join("\n");
    expect(text).not.toContain("errado-123");
    expect(text).not.toContain("project=p1");
  });

  it("truncates path to 200 and host to 100 characters", async () => {
    const lines: string[] = [];
    const app = await open((m) => lines.push(m));
    const res = await app.inject({
      method: "GET",
      url: "/" + "a".repeat(499),
      headers: { host: "h".repeat(300) },
    });
    expect(res.statusCode).toBe(403);
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] as string) as { path: string; host: string };
    expect(line.path).toHaveLength(200);
    expect(line.host).toHaveLength(100);
  });

  it("caps the log: one limit line per window and nothing after it", async () => {
    const lines: string[] = [];
    const app = await open((m) => lines.push(m));
    for (let i = 0; i < 3; i++) await status(app, "errado");
    expect(lines).toHaveLength(4);
    expect(lines.filter((l) => JSON.parse(l).msg === "request refused")).toHaveLength(3);
    expect(JSON.parse(lines[3] as string)).toEqual({
      level: "warn",
      msg: "attempt limit reached",
      maxFailures: 3,
      windowMs: 60000,
    });
    for (let i = 0; i < 5; i++) expect((await status(app, "errado")).statusCode).toBe(429);
    for (let i = 0; i < 5; i++) expect((await evil(app)).statusCode).toBe(403);
    expect(lines).toHaveLength(4);
  });

  it("keeps counting when the log throws", async () => {
    const app = await open(() => {
      throw new Error("x");
    });
    for (let i = 0; i < 3; i++) expect((await status(app, "errado")).statusCode).toBe(401);
    expect((await status(app, "errado")).statusCode).toBe(429);
  });
});
