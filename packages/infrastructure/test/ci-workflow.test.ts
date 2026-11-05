import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const ciPath = resolve(import.meta.dirname, "../../../.github/workflows/ci.yml");

type Job = {
  "runs-on"?: string;
  strategy?: { matrix?: unknown };
  steps?: Array<{ run?: string; with?: Record<string, unknown> }>;
};

function verify(text: string): { check: Job; windows: Job } {
  const jobs = parse(text).jobs as Record<string, Job>;
  const check = jobs["check"];
  const windows = jobs["sqlite-windows"];
  if (!check || !windows) throw new Error("jobs ausentes");
  if (check["runs-on"] !== "ubuntu-latest") throw new Error("check deve rodar em ubuntu-latest");
  if (check.strategy) throw new Error("check não pode ter strategy");
  return { check, windows };
}

describe("ci workflow", () => {
  it("keeps the check job and adds sqlite-windows", () => {
    const { windows } = verify(readFileSync(ciPath, "utf8"));
    expect(windows["runs-on"]).toBe("windows-latest");
    const steps = windows.steps ?? [];
    expect(steps.some((s) => String(s.with?.["node-version"]) === "26")).toBe(true);
    const runs = steps.map((s) => s.run);
    expect(runs).toContain("pnpm install --frozen-lockfile");
    expect(runs).toContain("pnpm --filter @friday/infrastructure exec vitest run test/sqlite");
  });

  it("rejects a check job with a matrix", () => {
    const text = readFileSync(ciPath, "utf8").replace(
      "  check:\n    runs-on: ubuntu-latest\n",
      "  check:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        os: [ubuntu-latest]\n",
    );
    expect(() => verify(text)).toThrow();
  });
});
