import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { projectItem } from "@friday/contracts";
import { buildApp } from "../src/index.ts";
import { openFixture, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

function projectRows(f: Fixture): number {
  const r = f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number };
  return r.n;
}

describe("GET /projects", () => {
  it("lists the project ids and validates against projectItem", async () => {
    f = openFixture();
    const app = await buildApp(f.deps);
    const res = await app.inject({ method: "GET", url: "/projects" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: "p1" }, { id: "p2" }]);
    expect(z.array(projectItem).safeParse(res.json()).success).toBe(true);
    await app.close();
  });

  it("lists ids in ascending order and answers an empty list", async () => {
    f = openFixture();
    f.db.sqlite.prepare("DELETE FROM projects").run();
    const app = await buildApp(f.deps);
    const empty = await app.inject({ method: "GET", url: "/projects" });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual([]);
    for (const id of ["b/x", "a/y"]) {
      f.db.sqlite.prepare("INSERT INTO projects (id) VALUES (?)").run(id);
    }
    const res = await app.inject({ method: "GET", url: "/projects" });
    expect(res.json()).toEqual([{ id: "a/y" }, { id: "b/x" }]);
    await app.close();
  });

  it("rejects writes with 404 and leaves rows unchanged", async () => {
    f = openFixture();
    const app = await buildApp(f.deps);
    const before = { ...countAll(f), projects: projectRows(f) };
    await app.inject({ method: "GET", url: "/projects" });
    for (const method of ["POST", "PUT", "DELETE"] as const) {
      const res = await app.inject({
        method,
        url: "/projects",
        payload: method === "DELETE" ? undefined : {},
      });
      expect(res.statusCode, method).toBe(404);
    }
    expect({ ...countAll(f), projects: projectRows(f) }).toEqual(before);
    await app.close();
  });
});

function countAll(f: Fixture): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of ["events", "runs", "ledger"]) {
    const r = f.db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
    out[t] = r.n;
  }
  return out;
}
