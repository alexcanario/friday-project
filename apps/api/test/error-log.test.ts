import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { GitHubFailure } from "../src/routes/approvals.ts";
import { HEAD, openFixture, seedApproval, type Fixture } from "./helpers.ts";

let f: Fixture;
let app: FastifyInstance;
let lines: string[];

afterEach(async () => {
  await app?.close();
  f.db.close();
});

const headers = { "x-friday-token": "s3cret" };

async function boot(setup: (fx: Fixture) => void = () => {}): Promise<void> {
  f = openFixture();
  seedApproval(f);
  f.deps.panelToken = "s3cret";
  lines = [];
  f.deps.log = (m) => void lines.push(m);
  setup(f);
  app = await buildApp(f.deps);
}

const post = (action: "approve" | "deny", extra: Record<string, string> = {}, query = "") =>
  app.inject({
    method: "POST",
    url: `/approvals/00000001/${action}${query}`,
    headers: { ...headers, ...extra },
  });

const failIssues = (fx: Fixture): void => {
  fx.deps.issues.get = () => {
    throw new Error("SQLITE_BUSY segredo-db");
  };
};

const rejectHead = (reason: unknown) => (fx: Fixture) => {
  fx.deps.readPrHead = async () => {
    throw reason;
  };
};

const rejectMerge = (fx: Fixture): void => {
  fx.deps.readPrHead = async () => HEAD;
  fx.deps.github = {
    squashMerge: async () => {
      throw new Error("falha-original");
    },
  };
};

describe("error log", () => {
  it("logs a 500 as one json line and keeps the fixed body", async () => {
    await boot(failIssues);
    const res = await post("deny");
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('{"error":"Erro interno."}');
    expect(res.body).not.toContain("segredo-db");
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] as string) as Record<string, any>;
    expect(line.level).toBe("error");
    expect(line.msg).toBe("unhandled error in request");
    expect(line.method).toBe("POST");
    expect(line.path).toBe("/approvals/00000001/deny");
    expect(line.err.name).toBe("Error");
    expect(line.err.message).toBe("SQLITE_BUSY segredo-db");
    expect(typeof line.err.stack).toBe("string");
    expect(line.err.stack.length).toBeGreaterThan(0);
  });

  it("logs the github cause on a 502 without sending it", async () => {
    await boot(rejectHead(new Error("falha-original")));
    const head = await post("approve");
    expect(head.statusCode).toBe(502);
    expect(head.body).toBe('{"error":"Falha ao consultar o GitHub."}');
    expect(head.body).not.toContain("falha-original");
    expect(lines).toHaveLength(1);
    const a = JSON.parse(lines[0] as string) as Record<string, any>;
    expect(a.msg).toBe("github call failed");
    expect(a.err.cause.message).toBe("falha-original");
    await app.close();
    f.db.close();

    await boot(rejectMerge);
    const merge = await post("approve");
    expect(merge.statusCode).toBe(502);
    expect(merge.body).toBe('{"error":"Falha ao consultar o GitHub."}');
    expect(lines).toHaveLength(1);
    const b = JSON.parse(lines[0] as string) as Record<string, any>;
    expect(b.msg).toBe("github call failed");
    expect(b.err.cause.message).toBe("falha-original");
    await app.close();
    f.db.close();

    await boot(rejectHead("texto"));
    const plain = await post("approve");
    expect(plain.statusCode).toBe(502);
    const c = JSON.parse(lines[0] as string) as Record<string, any>;
    expect(c.err.cause).toBe("texto");
  });

  it("github failure keeps its cause", () => {
    const cause = new Error("origem");
    const failure = new GitHubFailure("github call failed", { cause });
    expect(failure.cause).toBe(cause);
    expect(failure.message).toBe("github call failed");
    expect(failure).toBeInstanceOf(GitHubFailure);
  });

  it("never logs headers, query or tokens", async () => {
    const extra = { authorization: "Bearer abc-bearer", cookie: "sid=abc-cookie" };
    const secrets = ["s3cret", "abc-bearer", "abc-cookie", "qs-secret"];
    const check = (): void => {
      expect(lines).toHaveLength(1);
      const text = lines.join("\n");
      for (const s of secrets) expect(text).not.toContain(s);
      const obj = JSON.parse(lines[0] as string) as Record<string, unknown>;
      for (const k of ["headers", "query", "body", "req"]) expect(obj).not.toHaveProperty(k);
      expect(obj.path as string).not.toContain("?");
    };
    await boot(failIssues);
    await post("deny", extra, "?q=qs-secret");
    check();
    await app.close();
    f.db.close();

    await boot(rejectHead(new Error("falha-original")));
    await post("approve", extra, "?q=qs-secret");
    check();
  });

  it("does not log 4xx and logs an error with status and no statusCode", async () => {
    await boot();
    expect((await app.inject({ method: "GET", url: "/issues", headers })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: "/rota-inexistente", headers })).statusCode,
    ).toBe(404);
    const denied = await app.inject({ method: "POST", url: "/approvals/00000001/deny" });
    expect(denied.statusCode).toBe(401);
    expect(lines).toEqual([]);
    await app.close();
    f.db.close();

    await boot((fx) => {
      fx.deps.issues.get = () => {
        throw Object.assign(new Error("x"), { status: 404 });
      };
    });
    const res = await post("deny");
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('{"error":"Erro interno."}');
    expect(lines).toHaveLength(1);
  });

  it("survives a throwing log and a cyclic cause", async () => {
    await boot((fx) => {
      failIssues(fx);
      fx.deps.log = () => {
        throw new Error("log quebrado");
      };
    });
    const a = await post("deny");
    expect(a.statusCode).toBe(500);
    expect(a.body).toBe('{"error":"Erro interno."}');
    expect(a.body).not.toContain("log quebrado");
    await app.close();
    f.db.close();

    await boot((fx) => {
      rejectHead(new Error("falha-original"))(fx);
      fx.deps.log = () => {
        throw new Error("log quebrado");
      };
    });
    const b = await post("approve");
    expect(b.statusCode).toBe(502);
    expect(b.body).toBe('{"error":"Falha ao consultar o GitHub."}');
    expect(b.body).not.toContain("log quebrado");

    const { logError } = await import("../src/error-log.ts");
    const e = new Error("ciclo");
    e.cause = e;
    const out: string[] = [];
    logError((m) => void out.push(m), "m", { method: "GET", url: "/x?y=1" }, e);
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0] as string) as Record<string, any>;
    expect(parsed.err.message).toBe("ciclo");
    expect(parsed.path).toBe("/x");
    expect(() => logError(undefined, "m", { method: "GET", url: "/" }, e)).not.toThrow();
  });
});
