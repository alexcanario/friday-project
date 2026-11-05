import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const spikeDir = resolve(import.meta.dirname, "..");
const rootDir = resolve(spikeDir, "../..");

describe("spike package", () => {
  it("pins exact versions and test script", () => {
    const pkg = JSON.parse(readFileSync(resolve(spikeDir, "package.json"), "utf8"));
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe("module");
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.dependencies).toEqual({
      "@anthropic-ai/claude-agent-sdk": "0.3.318",
      zod: "4.6.7",
    });
    expect(pkg.devDependencies).toEqual({ vitest: "5.1.0" });
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const version of Object.values(all) as string[]) {
      expect(version.startsWith("^") || version.startsWith("~")).toBe(false);
    }
  });

  it("stays outside the root workspace and has its own lockfile with peers", () => {
    const workspace = readFileSync(resolve(rootDir, "pnpm-workspace.yaml"), "utf8");
    const entries = workspace
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).replace(/["']/g, ""));
    expect(entries.some((entry) => entry.startsWith("spikes"))).toBe(false);
    const lockPath = resolve(spikeDir, "pnpm-lock.yaml");
    expect(existsSync(lockPath)).toBe(true);
    const lock = readFileSync(lockPath, "utf8");
    expect(lock).toContain("@modelcontextprotocol/sdk");
    expect(lock).toContain("@anthropic-ai/sdk");
  });
});
