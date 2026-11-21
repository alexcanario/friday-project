import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { openFixture, seedIssues, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

const TOKEN = "s3cret";
const REJECTED_HEADERS: Record<string, string>[] = [
  {},
  { "x-friday-token": "errado" },
  { "x-friday-token": "s3cretX" },
  { "x-friday-token": "s3crét" },
  { "x-friday-token": "" },
];
const READS = [
  "/status?project=p1",
  "/issues?project=p1",
  "/runs?project=p1",
  "/approvals?project=p1",
  "/ledger/days/2026-11-05?project=p1",
  "/projects",
  "/openapi.json",
];
const UNAUTHORIZED_WITHOUT_TOKEN = [
  "/events/stream?project=p1",
  "/issues/14/transitions?project=p1",
  "/runs/nope?project=p1",
  "/ledger/issues/14?project=p1",
];

describe("read routes need the panel token", () => {
  it("rejects reads without or with a wrong token and accepts the right one", async () => {
    f = openFixture();
    seedIssues(f);
    const app = await buildApp({ ...f.deps, panelToken: TOKEN });
    try {
      for (const url of READS) {
        for (const headers of REJECTED_HEADERS) {
          const res = await app.inject({ method: "GET", url, headers });
          const label = JSON.stringify([url, headers]);
          expect(res.statusCode, label).toBe(401);
          expect(res.json(), label).toEqual({ message: "Token do painel inválido." });
        }
        const ok = await app.inject({ method: "GET", url, headers: { "x-friday-token": TOKEN } });
        expect(ok.statusCode, url).toBe(200);
      }
      for (const url of UNAUTHORIZED_WITHOUT_TOKEN) {
        const res = await app.inject({ method: "GET", url });
        expect(res.statusCode, url).toBe(401);
      }
    } finally {
      await app.close();
    }
  });

  it("keeps health and the static panel open", async () => {
    f = openFixture();
    const webRoot = mkdtempSync(join(tmpdir(), "friday-web-token-"));
    mkdirSync(join(webRoot, "assets"));
    writeFileSync(join(webRoot, "index.html"), '<div id="root"></div>');
    writeFileSync(join(webRoot, "assets", "app.js"), "console.log(1);");
    const app = await buildApp({ ...f.deps, panelToken: TOKEN }, { webRoot });
    try {
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/assets/app.js" })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("leaves reads open when no token is configured", async () => {
    f = openFixture();
    for (const panelToken of [undefined, ""]) {
      const app = await buildApp({ ...f.deps, panelToken });
      try {
        const res = await app.inject({ method: "GET", url: "/status?project=p1" });
        expect(res.statusCode, JSON.stringify(panelToken)).toBe(200);
      } finally {
        await app.close();
      }
    }
  });

  describe("C5", () => {
    it("without a token reads are open and approve answers 401", async () => {
      f = openFixture();
      seedIssues(f);
      const app = await buildApp(f.deps, {});
      try {
        const read = await app.inject({ method: "GET", url: "/runs?project=p1" });
        expect(read.statusCode).toBe(200);
        const approve = await app.inject({ method: "POST", url: "/approvals/x/approve" });
        expect(approve.statusCode).toBe(401);
        expect(approve.json()).toEqual({ message: "Token do painel inválido." });
      } finally {
        await app.close();
      }
    });
  });

  it("uses the shared token comparison", () => {
    const src = join(import.meta.dirname, "../src");
    expect(readFileSync(join(src, "app.ts"), "utf8")).toMatch(
      /import \{[^}]*\bisPanelTokenValid\b[^}]*\} from "\.\/panel-token\.ts"/,
    );
    const files = readdirSync(src, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".ts"))
      .map((e) => join(e.parentPath, e.name));
    const users = files.filter((p) => readFileSync(p, "utf8").includes("timingSafeEqual"));
    expect(users.map((p) => p.replaceAll("\\", "/").split("/").pop())).toEqual(["panel-token.ts"]);
  });

  it("every API route except health requires the token", async () => {
    f = openFixture();
    const routes: { method: string | string[]; url: string }[] = [];
    const app = await buildApp(
      { ...f.deps, panelToken: TOKEN },
      { onRoute: (route) => routes.push(route) },
    );
    try {
      const guarded = routes.filter((r) => r.url !== "/health" && r.method !== "HEAD");
      expect(guarded.length).toBeGreaterThan(10);
      for (const route of guarded) {
        const methods = Array.isArray(route.method) ? route.method : [route.method];
        for (const method of methods.filter((m) => m !== "HEAD")) {
          const url = route.url.replace(/:[A-Za-z]+/g, "1");
          const res = await app.inject({ method: method as "GET" | "POST", url });
          expect(res.statusCode, `${method} ${route.url}`).toBe(401);
        }
      }
    } finally {
      await app.close();
    }
  });
});
