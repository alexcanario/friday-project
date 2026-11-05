import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pkgDir = resolve(import.meta.dirname, "..");
const drizzleDir = resolve(pkgDir, "drizzle");

function snapshot(): string {
  return readdirSync(drizzleDir, { recursive: true })
    .filter((f) => statSync(resolve(drizzleDir, String(f))).isFile())
    .map((f) => `${f}\n${readFileSync(resolve(drizzleDir, String(f)), "utf8")}`)
    .join("\n");
}

function kit(command: string) {
  return spawnSync("pnpm", ["exec", "drizzle-kit", command], {
    cwd: pkgDir,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

describe("migrations", () => {
  it("the migration matches the schema", () => {
    expect(readdirSync(drizzleDir).some((f) => /^0000_.*\.sql$/.test(f))).toBe(true);
    const before = snapshot();
    const check = kit("check");
    expect(check.status, check.stdout + check.stderr).toBe(0);
    const generate = kit("generate");
    expect(generate.status, generate.stdout + generate.stderr).toBe(0);
    expect(generate.stdout).toContain("No schema changes");
    expect(snapshot()).toBe(before);
  }, 60_000);
});
