import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp, type ApiDeps } from "../src/index.ts";
import { openFixture, seedApproval, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

describe("approval writes need the panel token", () => {
  it("rejects both writes with 401 without a valid panel token and changes nothing", async () => {
    f = openFixture();
    seedApproval(f);
    const squashMerge = vi.fn();
    const readPrHead = vi.fn();
    const eventsBefore = [f.deps.events.list("p1"), f.deps.events.list("p1", 14)];
    const cases: [string | undefined, Record<string, string>][] = [
      ["s3cret", {}],
      ["s3cret", { "x-friday-token": "errado" }],
      ["s3cret", { "x-friday-token": "s3cretX" }],
      ["s3cret", { "x-friday-token": "s3crét" }],
      ["s3cret", { "x-friday-token": "" }],
      [undefined, {}],
      [undefined, { "x-friday-token": "" }],
      [undefined, { "x-friday-token": "s3cret" }],
      ["", {}],
      ["", { "x-friday-token": "" }],
      ["", { "x-friday-token": "s3cret" }],
    ];
    for (const [panelToken, headers] of cases) {
      const deps = { ...f.deps, panelToken, github: { squashMerge }, readPrHead } as ApiDeps;
      const app = await buildApp(deps);
      for (const action of ["approve", "deny"]) {
        for (const id of ["00000001", "nope"]) {
          const res = await app.inject({
            method: "POST",
            url: `/approvals/${id}/${action}`,
            headers,
          });
          const label = JSON.stringify([panelToken, headers, action, id]);
          expect(res.statusCode, label).toBe(401);
          expect(res.json(), label).toEqual({ message: "Token do painel inválido." });
        }
      }
      await app.close();
    }
    expect(squashMerge).not.toHaveBeenCalled();
    expect(readPrHead).not.toHaveBeenCalled();
    expect(f.deps.approvals.get("00000001")?.decision).toBeNull();
    expect([f.deps.events.list("p1"), f.deps.events.list("p1", 14)]).toEqual(eventsBefore);
  });
});
