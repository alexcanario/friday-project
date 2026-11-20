import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type ApiDeps } from "../src/index.ts";
import { HEAD, openFixture, seedApproval, type Fixture } from "./helpers.ts";

let f: Fixture;
let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
  f.db.close();
});

const headers = { "x-friday-token": "s3cret" };

async function boot(over: Partial<ApiDeps> = {}): Promise<void> {
  f = openFixture();
  seedApproval(f);
  f.deps.panelToken = "s3cret";
  app = await buildApp({ ...f.deps, ...over });
}

const post = (action: "approve" | "deny") =>
  app.inject({ method: "POST", url: `/approvals/00000001/${action}`, headers });

describe("global error handler", () => {
  it("answers a fixed 500 without detail when applyInputs fails", async () => {
    f = openFixture();
    seedApproval(f);
    f.deps.panelToken = "s3cret";
    f.deps.issues.get = () => {
      throw new Error("SQLITE_BUSY segredo-db");
    };
    app = await buildApp(f.deps);
    const res = await post("deny");
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('{"error":"Erro interno."}');
    expect(res.body).not.toContain("segredo-db");
    const json = res.json() as Record<string, unknown>;
    expect(json).not.toHaveProperty("statusCode");
    expect(json).not.toHaveProperty("message");
  });

  it("keeps 502 for github failures and answers 500 for database failures in decideApproval", async () => {
    const boom = async (): Promise<never> => {
      throw new Error("segredo-xyz");
    };
    await boot({ readPrHead: boom });
    const head = await post("approve");
    expect(head.statusCode).toBe(502);
    expect(head.body).toBe('{"error":"Falha ao consultar o GitHub."}');
    await app.close();
    f.db.close();

    await boot({ readPrHead: async () => HEAD, github: { squashMerge: boom } });
    const merge = await post("approve");
    expect(merge.statusCode).toBe(502);
    expect(merge.body).toBe('{"error":"Falha ao consultar o GitHub."}');
    await app.close();
    f.db.close();

    await boot({
      readPrHead: async () => HEAD,
      unitOfWork: {
        run: () => {
          throw new Error("SQLITE_BUSY segredo-db");
        },
      },
    });
    const db = await post("approve");
    expect(db.statusCode).toBe(500);
    expect(db.body).toBe('{"error":"Erro interno."}');
    expect(db.body).not.toContain("segredo-db");
    expect(db.body).not.toContain("segredo-xyz");
  });

  it("keeps 400, 404 and 401 untouched", async () => {
    await boot();
    const bad = await app.inject({ method: "GET", url: "/issues", headers });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain('"statusCode":400');

    const missing = await app.inject({ method: "GET", url: "/rota-inexistente", headers });
    expect(missing.statusCode).toBe(404);

    const denied = await app.inject({ method: "POST", url: "/approvals/00000001/deny" });
    expect(denied.statusCode).toBe(401);
    expect(denied.body).toBe('{"message":"Token do painel inválido."}');
  });
});
