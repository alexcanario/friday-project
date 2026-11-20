import { request } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PORT, startApi } from "../src/index.ts";
import { openFixture, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

function getWithHost(port: number, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/health", headers: { host } }, (res) => {
      let body = "";
      res.on("data", (c: Buffer) => (body += c.toString()));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function rawHttp10(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    const socket = connect(port, "127.0.0.1", () => socket.write("GET /health HTTP/1.0\r\n\r\n"));
    socket.on("data", (c: Buffer) => (data += c.toString()));
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });
}

const DENIED = '{"message":"Host não permitido."}';

describe("startApi", () => {
  it("listens on 127.0.0.1 only, defaults to port 7777 and closes", async () => {
    f = openFixture();
    expect(DEFAULT_PORT).toBe(7777);
    // @ts-expect-error there is no host option: the API only listens on 127.0.0.1
    const api = await startApi({ deps: f.deps, port: 0, host: "0.0.0.0" });
    try {
      expect(api.address).toBe("127.0.0.1");
      expect(api.port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${api.port}/health`);
      expect(res.status).toBe(200);
    } finally {
      await api.close();
    }
    await expect(fetch(`http://127.0.0.1:${api.port}/health`)).rejects.toThrow();
  });

  it("always checks the host on startApi", async () => {
    f = openFixture();
    const api = await startApi({
      deps: f.deps,
      port: 0,
      allowedOrigins: ["http://painel.exemplo.com"],
    });
    try {
      expect((await getWithHost(api.port, `127.0.0.1:${api.port}`)).status).toBe(200);
      expect((await getWithHost(api.port, "painel.exemplo.com")).status).toBe(200);
      for (const host of ["evil.local", "127.0.0.1:1"]) {
        const res = await getWithHost(api.port, host);
        expect(res.status, host).toBe(403);
        expect(res.body, host).toBe(DENIED);
      }
      expect(await rawHttp10(api.port)).toMatch(/^HTTP\/1\.[01] 403 /);
    } finally {
      await api.close();
    }

    // @ts-expect-error there is no option to turn the host check off
    const open = await startApi({ deps: f.deps, port: 0, allowedHosts: () => [] });
    try {
      const res = await getWithHost(open.port, "evil.local");
      expect(res.status).toBe(403);
      expect(res.body).toBe(DENIED);
    } finally {
      await open.close();
    }

    const bare = await startApi({ deps: f.deps, port: 0 });
    try {
      expect((await getWithHost(bare.port, "evil.local")).status).toBe(403);
    } finally {
      await bare.close();
    }
  });
});
