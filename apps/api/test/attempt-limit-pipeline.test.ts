import net from "node:net";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { openFixture, type Fixture } from "./helpers.ts";

let f: Fixture | undefined;
let app: FastifyInstance | undefined;
const sockets: net.Socket[] = [];
const lines: string[] = [];

afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy();
  await app?.close();
  app = undefined;
  f?.db.close();
  f = undefined;
  lines.length = 0;
});

async function start(): Promise<number> {
  f = openFixture();
  app = await buildApp(
    { ...f.deps, panelToken: "s3cret", log: (m: string) => lines.push(m) },
    { attemptLimit: { maxFailures: 3, windowMs: 60000 } },
  );
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  return typeof addr === "object" && addr !== null ? addr.port : 0;
}

const request = (port: number, path: string, token: string) =>
  `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nx-friday-token: ${token}\r\n\r\n`;

const STATUS = /HTTP\/1\.1 (\d{3}) /g; // bodies have no trailing newline, so no line anchor
const statuses = (raw: string): number[] => [...raw.matchAll(STATUS)].map((m) => Number(m[1]));

function connect(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: "127.0.0.1", port }, () => resolve(s));
    s.once("error", reject);
    sockets.push(s);
  });
}

/** Reads from the socket until `done(raw)` holds, or fails after 2 s. */
function readUntil(s: net.Socket, done: (raw: string) => boolean, what: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    const timer = setTimeout(() => {
      s.off("data", onData);
      reject(new Error(`timeout waiting for ${what}; got ${JSON.stringify(raw)}`));
    }, 2000);
    const onData = (chunk: Buffer): void => {
      raw += chunk.toString("utf8");
      if (done(raw)) {
        clearTimeout(timer);
        s.off("data", onData);
        resolve(raw);
      }
    };
    s.on("data", onData);
  });
}

async function pipeline(port: number, n: number, path: string, token: string) {
  const s = await connect(port);
  s.write(request(port, path, token).repeat(n));
  const raw = await readUntil(s, (r) => statuses(r).length >= n, `${n} status lines`);
  s.destroy();
  return { codes: statuses(raw), raw };
}

/** Persistent socket: one request, the whole response (by content-length), then the next. */
async function serial(port: number, n: number, path: string, token: string): Promise<number[]> {
  const s = await connect(port);
  const codes: number[] = [];
  for (let i = 0; i < n; i += 1) {
    s.write(request(port, path, token));
    const raw = await readUntil(
      s,
      (r) => {
        const end = r.indexOf("\r\n\r\n");
        if (end < 0) return false;
        const len = /^content-length: (\d+)/im.exec(r.slice(0, end));
        return Buffer.byteLength(r.slice(end + 4)) >= Number(len?.[1] ?? 0);
      },
      `response ${i + 1}`,
    );
    codes.push(...statuses(raw));
  }
  return codes;
}

const getStatus = (port: number, token: string) =>
  fetch(`http://127.0.0.1:${port}/status?project=p1`, { headers: { "x-friday-token": token } });
const refused = () => lines.filter((l) => JSON.parse(l).msg === "request refused");
const P = "/status?project=p1";

describe("attempt limit with pipelined requests", () => {
  it("C1 › 20 wrong tokens in one write give 401 then 19 429", async () => {
    const port = await start();
    const { codes } = await pipeline(port, 20, P, "errado");
    expect(codes).toEqual([401, ...Array<number>(19).fill(429)]);
  });

  it("C2 › a pipelined burst counts one refusal", async () => {
    const port = await start();
    await pipeline(port, 20, P, "errado");
    expect(refused()).toHaveLength(1);
    expect((await getStatus(port, "errado")).status).toBe(401);
    expect((await getStatus(port, "errado")).status).toBe(401);
    expect((await getStatus(port, "errado")).status).toBe(429);
  });

  it("C3 › 20 valid requests in one write give 200 then 19 429 with retry-after 1", async () => {
    const port = await start();
    const { codes, raw } = await pipeline(port, 20, P, "s3cret");
    expect(codes).toEqual([200, ...Array<number>(19).fill(429)]);
    expect(raw.match(/^retry-after: 1\r$/gim)).toHaveLength(19);
  });

  it("C4 › pipeline 429 does not block other connections", async () => {
    const port = await start();
    await pipeline(port, 20, P, "s3cret");
    expect((await getStatus(port, "s3cret")).status).toBe(200);
    expect((await getStatus(port, "errado")).status).toBe(401);
  });

  it("C5 › pipelined /health stays exempt", async () => {
    const port = await start();
    const { codes } = await pipeline(port, 5, "/health", "s3cret");
    expect(codes).toEqual([200, 200, 200, 200, 200]);
  });

  it("C6 › 50 sequential requests on one keep-alive connection all answer 200", async () => {
    const port = await start();
    let connections = 0;
    app?.server.on("connection", () => {
      connections += 1;
    });
    const codes = await serial(port, 50, P, "s3cret");
    expect(codes).toEqual(Array<number>(50).fill(200));
    expect(connections).toBe(1);
  });

  it("C7 › sequential refusals on one connection free the slot", async () => {
    const port = await start();
    expect(await serial(port, 4, P, "errado")).toEqual([401, 401, 401, 429]);
  });

  it("C8 › an open SSE stream keeps working and does not throttle other requests", async () => {
    const port = await start();
    const s = await connect(port);
    s.write(request(port, "/events/stream?project=p1", "s3cret"));
    const raw = await readUntil(s, (r) => r.includes("\r\n\r\n"), "stream headers");
    expect(raw).toMatch(/^HTTP\/1\.1 200 /);
    expect(raw).toMatch(/^content-type: text\/event-stream/im);
    for (let i = 0; i < 20; i += 1) expect((await getStatus(port, "s3cret")).status).toBe(200);
    expect(s.destroyed).toBe(false);
  });
});
