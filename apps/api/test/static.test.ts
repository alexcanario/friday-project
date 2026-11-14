import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, startApi } from "../src/index.ts";
import { DEFAULT_WEB_ROOT } from "../src/listen.ts";
import { openFixture, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

function makeWebRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "friday-web-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), '<div id="root"></div>');
  writeFileSync(join(dir, "assets", "app.js"), "console.log(1);");
  return dir;
}

describe("static web build", () => {
  it("serves the web build, keeps API routes, rejects writes and sends no CORS header", async () => {
    f = openFixture();
    const app = await buildApp(f.deps, { webRoot: makeWebRoot() });
    try {
      const root = await app.inject({ method: "GET", url: "/" });
      expect(root.statusCode).toBe(200);
      expect(String(root.headers["content-type"])).toMatch(/^text\/html/);
      expect(root.body).toContain('<div id="root"></div>');
      const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
      expect(asset.statusCode).toBe(200);
      const health = await app.inject({ method: "GET", url: "/health" });
      expect(health.json()).toEqual({ status: "ok" });
      const spec = await app.inject({ method: "GET", url: "/openapi.json" });
      const paths = Object.keys((spec.json() as { paths: object }).paths);
      expect(paths).not.toContain("/");
      expect(paths).not.toContain("/*");
      expect((await app.inject({ method: "GET", url: "/nao-existe" })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: "/" })).statusCode).toBe(404);
      for (const res of [root, asset, health, spec]) {
        expect(res.headers["access-control-allow-origin"]).toBeUndefined();
      }
    } finally {
      await app.close();
    }
  });

  it("does not serve static files without webRoot or without index.html", async () => {
    f = openFixture();
    const empty = mkdtempSync(join(tmpdir(), "friday-web-empty-"));
    for (const options of [undefined, {}, { webRoot: empty }]) {
      const app = await buildApp(f.deps, options);
      try {
        expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(404);
        expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
      } finally {
        await app.close();
      }
    }
  });

  it("DEFAULT_WEB_ROOT equals path.resolve", () => {
    const expected = resolve(join(import.meta.dirname, "../src"), "../../web/dist");
    expect(DEFAULT_WEB_ROOT).toBe(expected);
  });

  it("startApi serves the web root on 127.0.0.1 and survives a missing dist", async () => {
    f = openFixture();
    const api = await startApi({ deps: f.deps, port: 0, webRoot: makeWebRoot() });
    try {
      expect(api.address).toBe("127.0.0.1");
      expect((await fetch(`http://127.0.0.1:${api.port}/`)).status).toBe(200);
    } finally {
      await api.close();
    }
    const missing = join(tmpdir(), "friday-web-does-not-exist", "dist");
    const api2 = await startApi({ deps: f.deps, port: 0, webRoot: missing });
    try {
      expect((await fetch(`http://127.0.0.1:${api2.port}/`)).status).toBe(404);
    } finally {
      await api2.close();
    }
  });
});
