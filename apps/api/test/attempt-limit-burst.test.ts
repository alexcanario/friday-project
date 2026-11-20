import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type BuildAppOptions } from "../src/index.ts";
import { registerAttemptLimit } from "../src/attempt-limit.ts";
import { openFixture, type Fixture } from "./helpers.ts";

let f: Fixture | undefined;
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  f?.db.close();
  f = undefined;
});

const LIMIT = { maxFailures: 3, windowMs: 60000 };

async function listen(
  options: BuildAppOptions = { attemptLimit: LIMIT },
  deps: Partial<Fixture["deps"]> = {},
): Promise<string> {
  f = openFixture();
  app = await buildApp({ ...f.deps, panelToken: "s3cret", ...deps }, options);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  return `http://127.0.0.1:${port}`;
}

const getStatus = (base: string, token: string) =>
  fetch(`${base}/status?project=p1`, { headers: { "x-friday-token": token } });

async function burst(n: number, run: () => Promise<Response>): Promise<number[]> {
  const responses = await Promise.all(Array.from({ length: n }, run));
  return responses.map((r) => r.status);
}

const count = (codes: number[], code: number) => codes.filter((c) => c === code).length;

describe("attempt limit under a parallel burst", () => {
  it("20 parallel wrong tokens give exactly 3 401 and 17 429", async () => {
    const base = await listen();
    const codes = await burst(20, () => getStatus(base, "errado"));
    expect(count(codes, 401)).toBe(3);
    expect(count(codes, 429)).toBe(17);
  });

  it("20 parallel valid requests are never blocked", async () => {
    const base = await listen();
    const codes = await burst(20, () => getStatus(base, "s3cret"));
    expect(count(codes, 200)).toBe(20);
    expect((await getStatus(base, "errado")).status).toBe(401);
  });

  it("valid requests are not blocked by a mixed burst", async () => {
    const base = await listen();
    const tasks = [
      ...Array.from({ length: 2 }, () => getStatus(base, "errado").then((r) => ["bad", r.status])),
      ...Array.from({ length: 30 }, () => getStatus(base, "s3cret").then((r) => ["ok", r.status])),
    ];
    const results = await Promise.all(tasks);
    expect(results.filter(([k, s]) => k === "ok" && s === 200)).toHaveLength(30);
    expect(results.filter(([k, s]) => k === "bad" && s === 401)).toHaveLength(2);
  });

  it("an open SSE stream does not hold a slot", async () => {
    const base = await listen();
    const stream = await fetch(`${base}/events/stream?project=p1`, {
      headers: { "x-friday-token": "s3cret" },
    });
    try {
      expect(stream.status).toBe(200);
      expect(stream.headers.get("content-type")).toContain("text/event-stream");
      const codes = await burst(20, () => getStatus(base, "s3cret"));
      expect(count(codes, 200)).toBe(20);
    } finally {
      await stream.body?.cancel();
    }
    await app?.close();
    app = undefined;
  });

  it("expired-token burst is capped at the limit", async () => {
    const now = () => 1_000_000;
    const base = await listen({ attemptLimit: LIMIT }, { now, panelTokenExpiresAt: now() });
    const codes = await burst(20, () => getStatus(base, "s3cret"));
    expect(count(codes, 401)).toBe(3);
    expect(count(codes, 429)).toBe(17);
  });

  it("refused-host burst is capped at the limit", async () => {
    // The Host check runs before the limit (app.ts order), so refused hosts keep getting 403; they still count.
    let allowed = ["outro.local"];
    const lines: string[] = [];
    const base = await listen(
      { attemptLimit: LIMIT, allowedHosts: () => allowed },
      { log: (m) => lines.push(m) },
    );
    const codes = await burst(20, () => getStatus(base, "s3cret"));
    expect(count(codes, 403)).toBe(20);
    expect(lines.filter((l) => JSON.parse(l).msg === "request refused")).toHaveLength(3);
    allowed = [new URL(base).host];
    expect((await getStatus(base, "s3cret")).status).toBe(429);
  });

  it("/health/ is still limited after a burst", async () => {
    const base = await listen();
    await burst(20, () => getStatus(base, "errado"));
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/health/`)).status).toBe(429);
  });

  it("burst logs 3 refusals and one limit line without the token", async () => {
    const lines: string[] = [];
    const base = await listen({ attemptLimit: LIMIT }, { log: (m) => lines.push(m) });
    await burst(20, () => getStatus(base, "errado-xyz"));
    const parsed = lines.map((l) => JSON.parse(l) as { msg: string });
    expect(parsed.filter((l) => l.msg === "request refused")).toHaveLength(3);
    expect(parsed.filter((l) => l.msg === "attempt limit reached")).toHaveLength(1);
    const text = lines.join("\n");
    expect(text).not.toContain("errado-xyz");
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("project=p1");
  });

  it("counts the refusal before the response finishes", async () => {
    const bare = Fastify();
    registerAttemptLimit(bare, { maxFailures: 1, windowMs: 60000 }, () => 1000000);
    let inner = 0;
    bare.get("/ok", async () => ({ ok: true }));
    bare.get(
      "/deny",
      {
        onSend: async (_req, _reply, payload) => {
          inner = (await bare.inject({ method: "GET", url: "/ok" })).statusCode;
          return payload;
        },
      },
      async (_req, reply) => reply.code(401).send({}),
    );
    try {
      const res = await bare.inject({ method: "GET", url: "/deny" });
      expect(res.statusCode).toBe(401);
      expect(inner).toBe(429);
    } finally {
      await bare.close();
    }
  });
});
