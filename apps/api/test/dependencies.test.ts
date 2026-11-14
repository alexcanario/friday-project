import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const EXACT = /^\d+\.\d+\.\d+$/;

describe("api dependencies", () => {
  it("pins fastify, fastify-type-provider-zod, zod, @fastify/swagger and openapi-types exactly", () => {
    const d = pkg.dependencies;
    expect(d["fastify"]).toBe("5.12.8");
    expect(d["fastify-type-provider-zod"]).toBe("7.0.0");
    expect(d["zod"]).toBe("4.6.7");
    for (const name of ["@fastify/swagger", "openapi-types"]) {
      expect(d[name], name).toMatch(EXACT);
    }
    const [major, minor, patch] = d["@fastify/swagger"]!.split(".").map(Number) as [
      number,
      number,
      number,
    ];
    expect(major).toBeGreaterThanOrEqual(9);
    if (major === 9) expect(minor > 5 || (minor === 5 && patch >= 1)).toBe(true);
    expect(d["openapi-types"]!.split(".")[0]).toBe("12");
    expect(d["@friday/application"]).toBe("workspace:*");
    expect(d["@friday/infrastructure"]).toBe("workspace:*");
  });
});

describe("api dependencies for the web panel", () => {
  it("pins @fastify/static and depends on contracts", () => {
    expect(pkg.dependencies["@fastify/static"]).toBe("10.1.11");
    expect(pkg.dependencies["@friday/contracts"]).toBe("workspace:*");
  });
});
