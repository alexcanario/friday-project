import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createInstallationTokenProvider } from "../src/index.ts";

const T0 = Date.UTC(2026, 0, 1);
const URL_TOKENS = "https://api.github.com/app/installations/2/access_tokens";

let dir: string;
let pkcs8Path: string;
let pkcs1Path: string;
let pkcs8Body: string;

function writeKey(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function bodyLines(pem: string): string[] {
  return pem.split("\n").filter((l) => l.length > 20 && !l.startsWith("-----"));
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "itp-"));
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pkcs8 = rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  pkcs8Body = pkcs8;
  pkcs8Path = writeKey("k8.pem", pkcs8);
  pkcs1Path = writeKey(
    "k1.pem",
    rsa.privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
  );
});

interface Call {
  url: string;
  method: string;
  authorization: string;
}

function fakeFetch(respond: (n: number) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const f = (async (input: Request | URL | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : undefined;
    const headers = new Headers(req?.headers ?? init?.headers);
    calls.push({
      url: req ? req.url : String(input),
      method: (req?.method ?? init?.method ?? "GET").toUpperCase(),
      authorization: headers.get("authorization") ?? "",
    });
    return respond(calls.length);
  }) as typeof fetch;
  return { fetch: f, calls };
}

function tokenResponse(n: number, now: number, withExpiry = true): Response {
  const body: Record<string, string> = { token: `tok-${n}` };
  if (withExpiry) body.expires_at = new Date(now + 3600_000).toISOString();
  return new Response(JSON.stringify(body), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
}

function setup(path: string, f: typeof fetch, clock: { t: number }) {
  return createInstallationTokenProvider({
    appId: 1,
    installationId: 2,
    privateKeyPath: path,
    now: () => clock.t,
    fetch: f,
  });
}

describe("createInstallationTokenProvider", () => {
  it("getToken requests an installation token signed with the app key", async () => {
    const clock = { t: T0 };
    const { fetch: f, calls } = fakeFetch((n) => tokenResponse(n, T0));
    expect(await setup(pkcs8Path, f, clock).getToken()).toBe("tok-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(URL_TOKENS);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.authorization).toMatch(/^bearer /i);
  });

  it("getToken accepts a pkcs1 RSA key", async () => {
    const { fetch: f } = fakeFetch((n) => tokenResponse(n, T0));
    expect(await setup(pkcs1Path, f, { t: T0 }).getToken()).toBe("tok-1");
  });

  it("getToken reuses the token while 300 s or more remain", async () => {
    const clock = { t: T0 };
    const { fetch: f, calls } = fakeFetch((n) => tokenResponse(n, T0));
    const p = setup(pkcs8Path, f, clock);
    await p.getToken();
    clock.t = T0 + 3000_000;
    expect(await p.getToken()).toBe("tok-1");
    clock.t = T0 + 3300_000;
    expect(await p.getToken()).toBe("tok-1");
    expect(calls).toHaveLength(1);
  });

  it("getToken requests a new token when less than 300 s remain", async () => {
    const clock = { t: T0 };
    const { fetch: f, calls } = fakeFetch((n) => tokenResponse(n, T0));
    const p = setup(pkcs8Path, f, clock);
    await p.getToken();
    clock.t = T0 + 3301_000;
    expect(await p.getToken()).toBe("tok-2");
    expect(calls).toHaveLength(2);
  });

  it("getToken rejects an invalid or missing key file in pt-BR without leaking it", async () => {
    const paths = [
      writeKey("bad.pem", "not-a-key"),
      writeKey("empty.pem", ""),
      join(dir, "missing.pem"),
    ];
    for (const path of paths) {
      const { fetch: f, calls } = fakeFetch((n) => tokenResponse(n, T0));
      const p = setup(path, f, { t: T0 });
      const err = await p.getToken().then(
        () => undefined,
        (e: unknown) => e as Error,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err?.message).toContain(path);
      expect(err?.message).not.toContain("not-a-key");
      expect(err?.message).toMatch(/chave/i);
      expect(calls).toHaveLength(0);
    }
  });

  it("getToken rejects a non-RSA key in pt-BR", async () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const path = writeKey("ec.pem", pem);
    const { fetch: f, calls } = fakeFetch((n) => tokenResponse(n, T0));
    const err = await setup(path, f, { t: T0 })
      .getToken()
      .then(
        () => undefined,
        (e: unknown) => e as Error,
      );
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain(path);
    for (const line of bodyLines(pem)) expect(err?.message).not.toContain(line);
    expect(calls).toHaveLength(0);
  });

  it("getToken refreshes on every call when expires_at is missing", async () => {
    const { fetch: f, calls } = fakeFetch((n) => tokenResponse(n, T0, false));
    const p = setup(pkcs8Path, f, { t: T0 });
    await p.getToken();
    await p.getToken();
    expect(calls).toHaveLength(2);
  });

  it("getToken rethrows a network error in pt-BR without cause or secrets", async () => {
    const { fetch: f } = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const err = await setup(pkcs8Path, f, { t: T0 })
      .getToken()
      .then(
        () => undefined,
        (e: unknown) => e as Error,
      );
    expect(err).toBeInstanceOf(Error);
    expect(err?.cause).toBeUndefined();
    expect(err?.message).toMatch(/token/i);
    expect(err?.message).not.toMatch(/bearer /i);
    for (const line of bodyLines(pkcs8Body)) expect(err?.message).not.toContain(line);
  });

  it("getToken rejects a 401 without leaking the jwt", async () => {
    const { fetch: f, calls } = fakeFetch(
      () =>
        new Response(JSON.stringify({ message: "Bad credentials" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    const err = await setup(pkcs8Path, f, { t: T0 })
      .getToken()
      .then(
        () => undefined,
        (e: unknown) => e as Error,
      );
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain("401");
    expect(err?.cause).toBeUndefined();
    const jwt = calls[0]?.authorization.replace(/^bearer /i, "") ?? "";
    expect(jwt.length).toBeGreaterThan(20);
    expect(err?.message).not.toContain(jwt);
    for (const line of bodyLines(pkcs8Body)) expect(err?.message).not.toContain(line);
  });

  it("index exports createInstallationTokenProvider", () => {
    expect(typeof createInstallationTokenProvider).toBe("function");
  });
});
