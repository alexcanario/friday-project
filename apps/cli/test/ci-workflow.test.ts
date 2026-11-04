import { describe, expect, it } from "vitest";
import { readText } from "./helpers.ts";

describe("ci workflow", () => {
  it("keeps the check job on ubuntu and runs install, typecheck, lint and test without --if-present", () => {
    const ci = readText(".github/workflows/ci.yml");
    expect(ci).not.toContain("--if-present");
    expect(ci).not.toContain("Detect workspace");
    expect(ci).not.toContain("secrets.");
    expect(ci).toMatch(/^permissions:\n\s+contents: read$/m);

    const start = ci.indexOf("\n  check:");
    expect(start).toBeGreaterThan(-1);
    const rest = ci.slice(start + 1);
    const next = rest.slice("  check:".length).search(/\n {2}[A-Za-z0-9_-]+:/);
    const job = next === -1 ? rest : rest.slice(0, "  check:".length + next);
    expect(job).toMatch(/runs-on: ubuntu-latest/);
    expect(job).not.toMatch(/^\s{4}strategy:/m);
    expect(job).not.toMatch(/^\s{4}name:/m);

    const cmds = [
      "pnpm install --frozen-lockfile",
      "pnpm -r typecheck",
      "pnpm -r lint",
      "pnpm -r test",
    ];
    const positions = cmds.map((c) => job.indexOf(c));
    positions.forEach((p) => expect(p).toBeGreaterThan(-1));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
