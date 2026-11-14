import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const ciPath = resolve(import.meta.dirname, "../../../.github/workflows/ci.yml");

type Job = {
  "runs-on"?: string;
  strategy?: { matrix?: unknown };
  env?: Record<string, unknown>;
  steps?: Array<{ run?: string; uses?: string; with?: Record<string, unknown> }>;
};

function verify(text: string): { check: Job; sqlite: Job; windows: Job } {
  const jobs = parse(text).jobs as Record<string, Job>;
  const check = jobs["check"];
  const sqlite = jobs["sqlite-windows"];
  const windows = jobs["windows"];
  if (!check || !sqlite) throw new Error("jobs ausentes");
  if (!windows) throw new Error("job windows ausente");
  if (check["runs-on"] !== "ubuntu-latest") throw new Error("check deve rodar em ubuntu-latest");
  if (check.strategy) throw new Error("check não pode ter strategy");
  if (windows["runs-on"] !== "windows-latest")
    throw new Error("windows deve rodar em windows-latest");
  if (windows.strategy) throw new Error("windows não pode ter strategy");
  if (
    check.env?.FRIDAY_REQUIRE_CONFIG_HOOKS !== "1" ||
    windows.env?.FRIDAY_REQUIRE_CONFIG_HOOKS !== "1"
  )
    throw new Error("check e windows devem definir FRIDAY_REQUIRE_CONFIG_HOOKS=1");
  const steps = windows.steps ?? [];
  if (steps[0]?.run !== "git config --global core.autocrlf false")
    throw new Error("primeiro passo do windows deve desligar o autocrlf");
  if (!steps.some((s) => s.run === "pnpm -r test"))
    throw new Error("windows deve rodar pnpm -r test");
  return { check, sqlite, windows };
}

describe("ci workflow", () => {
  it("keeps the check job and adds sqlite-windows", () => {
    const { sqlite } = verify(readFileSync(ciPath, "utf8"));
    expect(sqlite["runs-on"]).toBe("windows-latest");
    const steps = sqlite.steps ?? [];
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

  it("adds a windows job that runs pnpm -r test", () => {
    const { check, windows } = verify(readFileSync(ciPath, "utf8"));
    expect(check["runs-on"]).toBe("ubuntu-latest");
    expect(windows["runs-on"]).toBe("windows-latest");
    expect(windows.strategy).toBeUndefined();
    const steps = windows.steps ?? [];
    expect(steps[0]?.run).toBe("git config --global core.autocrlf false");
    expect(
      steps.some(
        (s) => s.uses === "actions/setup-node@v4" && String(s.with?.["node-version"]) === "26",
      ),
    ).toBe(true);
    const runs = steps.map((s) => s.run);
    expect(runs).toContain("pnpm install --frozen-lockfile");
    expect(runs).toContain("pnpm -r test");
  });

  it("rejects a windows job on ubuntu, with a strategy or without pnpm -r test", () => {
    const text = readFileSync(ciPath, "utf8");
    const head = "  windows:\n    runs-on: windows-latest\n";
    expect(text).toContain(head);
    expect(() => verify(text.replace(head, "  windows:\n    runs-on: ubuntu-latest\n"))).toThrow();
    expect(() =>
      verify(
        text.replace(head, head + "    strategy:\n      matrix:\n        os: [windows-latest]\n"),
      ),
    ).toThrow();
    const marker = "      - run: pnpm -r test\n";
    const at = text.lastIndexOf(marker);
    expect(at).toBeGreaterThan(text.indexOf(head));
    expect(() => verify(text.slice(0, at) + text.slice(at + marker.length))).toThrow();
  });

  it("rejects a windows job whose first step is not the autocrlf setting", () => {
    const text = readFileSync(ciPath, "utf8");
    const bad = text.replace("      - run: git config --global core.autocrlf false\n", "");
    expect(bad).not.toBe(text);
    expect(() => verify(bad)).toThrow();
  });

  it("sets FRIDAY_REQUIRE_CONFIG_HOOKS on check and windows only", () => {
    const { check, sqlite, windows } = verify(readFileSync(ciPath, "utf8"));
    expect(check.env?.FRIDAY_REQUIRE_CONFIG_HOOKS).toBe("1");
    expect(windows.env?.FRIDAY_REQUIRE_CONFIG_HOOKS).toBe("1");
    expect(sqlite.env?.FRIDAY_REQUIRE_CONFIG_HOOKS).toBeUndefined();
  });

  it("logs the git version on check", () => {
    const { check } = verify(readFileSync(ciPath, "utf8"));
    expect(check["runs-on"]).toBe("ubuntu-latest");
    expect(check.strategy).toBeUndefined();
    expect((check.steps ?? []).some((s) => s.run === "git --version")).toBe(true);
  });

  it("rejects a windows job without the flag", () => {
    const text = readFileSync(ciPath, "utf8");
    const block = '    env:\n      FRIDAY_REQUIRE_CONFIG_HOOKS: "1"\n';
    const at = text.indexOf(block, text.indexOf("  windows:\n"));
    expect(at).toBeGreaterThan(-1);
    expect(() => verify(text.slice(0, at) + text.slice(at + block.length))).toThrow();
  });
});
