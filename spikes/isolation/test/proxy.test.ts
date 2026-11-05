import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectPort } from "../src/allowlist.ts";

const proxySource = resolve(import.meta.dirname, "../src/proxy.ts");

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = net.createServer();
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => done(port));
    });
  });
}

function connectLine(port: number, target: string): Promise<string> {
  return new Promise((done, fail) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    });
    socket.setEncoding("utf8");
    socket.once("data", (chunk: string) => {
      socket.destroy();
      done(chunk.split("\r\n")[0] as string);
    });
    socket.on("error", fail);
  });
}

describe("connectPort", () => {
  it("accepts valid ports and rejects the rest", () => {
    expect(connectPort(undefined)).toBe(443);
    expect(connectPort("")).toBe(443);
    expect(connectPort("1")).toBe(1);
    expect(connectPort("65535")).toBe(65535);
    for (const raw of ["0", "65536", "abc", "-1", "1.5"]) expect(connectPort(raw), raw).toBeNull();
  });
});

describe("proxy", () => {
  let child: ChildProcess;
  let port: number;

  beforeAll(async () => {
    port = await freePort();
    child = spawn(process.execPath, [proxySource], {
      env: { ...process.env, ALLOWLIST: "allowed.test", PORT: String(port) },
      stdio: ["ignore", "pipe", "inherit"],
    });
    await new Promise<void>((done, fail) => {
      child.stdout?.once("data", () => done());
      child.once("exit", (code) => fail(new Error(`proxy saiu com código ${code}`)));
    });
  });

  afterAll(() => {
    child.removeAllListeners("exit");
    child.kill();
  });

  it("answers 400 to an invalid CONNECT port and keeps running", async () => {
    expect(await connectLine(port, "allowed.test:65536")).toBe("HTTP/1.1 400 Bad Request");
    expect(child.exitCode).toBeNull();
    expect(await connectLine(port, "blocked.test:443")).toBe("HTTP/1.1 403 Forbidden");
  });
});
