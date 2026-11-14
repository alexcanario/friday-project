import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { countRows, openFixture, type Fixture } from "./helpers.ts";

const OPENED = "2026-11-05T01:00:00.000Z";
const FAILURE = "2026-11-05T00:59:00.000Z";
const OPEN_STATE = { openedAt: OPENED, failures: [FAILURE] };

let fixture: Fixture | undefined;
function fx(): Fixture {
  fixture = openFixture();
  return fixture;
}

async function get(f: Fixture, url: string) {
  const app = await buildApp(f.deps);
  const res = await app.inject({ method: "GET", url });
  await app.close();
  return res;
}

afterEach(() => {
  fixture?.db.sqlite.close();
  fixture = undefined;
});

describe("GET /status", () => {
  it("reports enabled true and a closed empty breaker when no breaker state is saved", async () => {
    const f = fx();
    f.deps.enabled.save("p1", true);
    const res = await get(f, "/status?project=p1");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      enabled: true,
      breaker: { open: false, openedAt: null, failures: [] },
    });
  });

  it("reports enabled false, and null when no value was ever saved", async () => {
    const f = fx();
    f.deps.enabled.save("p1", false);
    expect((await get(f, "/status?project=p1")).json()).toMatchObject({ enabled: false });
    expect((await get(f, "/status?project=p2")).json()).toMatchObject({ enabled: null });
  });

  it("reports the breaker open one millisecond before the 30 minutes end", async () => {
    const f = fx();
    f.deps.breaker.save("p1", OPEN_STATE);
    f.clock.now = Date.parse("2026-11-05T01:29:59.999Z");
    const res = await get(f, "/status?project=p1");
    expect(res.json()).toMatchObject({
      breaker: { open: true, openedAt: OPENED, failures: [FAILURE] },
    });
  });

  it("reports the breaker closed at exactly 30 minutes and when openedAt is null", async () => {
    const f = fx();
    f.deps.breaker.save("p1", OPEN_STATE);
    f.clock.now = Date.parse("2026-11-05T01:30:00.000Z");
    expect((await get(f, "/status?project=p1")).json()).toMatchObject({
      breaker: { open: false, openedAt: OPENED },
    });
    f.deps.breaker.save("p1", { openedAt: null, failures: [FAILURE] });
    expect((await get(f, "/status?project=p1")).json()).toMatchObject({
      breaker: { open: false },
    });
  });

  it("does not leak the breaker state of another project", async () => {
    const f = fx();
    f.deps.breaker.save("p1", OPEN_STATE);
    f.clock.now = Date.parse("2026-11-05T01:29:59.999Z");
    expect((await get(f, "/status?project=p2")).json()).toMatchObject({
      breaker: { open: false, openedAt: null, failures: [] },
    });
  });

  it("rejects a missing or empty project query with 400", async () => {
    const f = fx();
    expect((await get(f, "/status")).statusCode).toBe(400);
    expect((await get(f, "/status?project=")).statusCode).toBe(400);
  });

  it("leaves rows and saved state unchanged and rejects write methods with 404", async () => {
    const f = fx();
    f.deps.breaker.save("p1", OPEN_STATE);
    f.deps.enabled.save("p1", true);
    const before = countRows(f.db);
    await get(f, "/status?project=p1");
    expect(countRows(f.db)).toEqual(before);
    expect(f.deps.breaker.get("p1")).toEqual(OPEN_STATE);
    expect(f.deps.enabled.get("p1")).toBe(true);
    const app = await buildApp(f.deps);
    for (const method of ["POST", "PUT", "DELETE"] as const) {
      const res = await app.inject({ method, url: "/status?project=p1" });
      expect(res.statusCode).toBe(404);
    }
    await app.close();
  });

  it("documents GET /status in openapi.json without write methods", async () => {
    const f = fx();
    const doc = (await get(f, "/openapi.json")).json() as {
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    };
    const path = doc.paths["/status"];
    expect(path?.get?.responses?.["200"]).toBeDefined();
    for (const m of ["post", "put", "patch", "delete"]) expect(path).not.toHaveProperty(m);
  });
});
