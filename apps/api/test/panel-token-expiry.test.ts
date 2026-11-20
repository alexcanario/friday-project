import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type BuildAppOptions } from "../src/index.ts";
import { openFixture, type Fixture } from "./helpers.ts";

let f: Fixture;
afterEach(() => f.db.close());

const EXPIRED = '{"message":"Token do painel expirado."}';

async function open(
  now: number,
  expiresAt: number | undefined,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  f = openFixture();
  return buildApp(
    { ...f.deps, panelToken: "s3cret", panelTokenExpiresAt: expiresAt, now: () => now },
    options,
  );
}

const status = (app: FastifyInstance, token: string) =>
  app.inject({ method: "GET", url: "/status?project=p1", headers: { "x-friday-token": token } });

describe("panel token expiry", () => {
  it("answers 401 expired after the expiry time, keeps health open and counts toward the limit", async () => {
    const before = await open(4999, 5000);
    expect((await status(before, "s3cret")).statusCode).toBe(200);
    f.db.close();

    const at = await open(5000, 5000);
    for (const token of ["s3cret", "errado"]) {
      const res = await status(at, token);
      expect(res.statusCode).toBe(401);
      expect(res.body).toBe(EXPIRED);
    }
    expect((await at.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    f.db.close();

    const none = await open(9_999_999, undefined);
    expect((await status(none, "s3cret")).statusCode).toBe(200);
    f.db.close();

    const limited = await open(5000, 5000, { attemptLimit: { maxFailures: 2, windowMs: 60000 } });
    expect((await status(limited, "s3cret")).statusCode).toBe(401);
    expect((await status(limited, "s3cret")).statusCode).toBe(401);
    expect((await status(limited, "s3cret")).statusCode).toBe(429);
  });
});
