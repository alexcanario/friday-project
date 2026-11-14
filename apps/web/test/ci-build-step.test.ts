import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("ci web build", () => {
  it("runs the web build after the tests in the check job", () => {
    const ci = readFileSync(join(import.meta.dirname, "../../../.github/workflows/ci.yml"), "utf8");
    const start = ci.indexOf("\n  check:");
    expect(start).toBeGreaterThan(-1);
    const rest = ci.slice(start + 1);
    const next = rest.slice("  check:".length).search(/\n {2}[A-Za-z0-9_-]+:/);
    const job = next === -1 ? rest : rest.slice(0, "  check:".length + next);
    expect(job).toMatch(/runs-on: ubuntu-latest/);
    expect(job).not.toMatch(/^\s{4}strategy:/m);
    expect(job).not.toMatch(/^\s{4}name:/m);
    const test = job.indexOf("- run: pnpm -r test");
    const build = job.indexOf("- run: pnpm --filter @friday/web build");
    expect(test).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(test);
  });
});
