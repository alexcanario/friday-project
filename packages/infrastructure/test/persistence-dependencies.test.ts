import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "../../..");
const pkg = JSON.parse(readFileSync(resolve(repo, "packages/infrastructure/package.json"), "utf8"));

describe("persistence dependencies", () => {
  it("pins the sqlite packages", () => {
    expect(pkg.dependencies["better-sqlite3"]).toBe("13.0.3");
    expect(pkg.dependencies["drizzle-orm"]).toBe("0.45.4");
    expect(pkg.devDependencies["drizzle-kit"]).toBe("0.31.11");
    expect(pkg.devDependencies["@types/better-sqlite3"]).toBe("9.6.0");
  });

  it("allows no esbuild build", () => {
    const ws = parse(readFileSync(resolve(repo, "pnpm-workspace.yaml"), "utf8"));
    expect(ws.allowBuilds.esbuild).toBe(false);
    expect(ws).not.toHaveProperty("onlyBuiltDependencies");
  });
});
