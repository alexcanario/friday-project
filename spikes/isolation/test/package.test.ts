import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const spikeDir = resolve(import.meta.dirname, "..");

describe("package.json", () => {
  it("pins vitest only and stays outside the workspace", () => {
    const pkg = JSON.parse(readFileSync(resolve(spikeDir, "package.json"), "utf8"));
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe("module");
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.devDependencies).toEqual({ vitest: "5.1.0" });
    expect(pkg).not.toHaveProperty("dependencies");
    expect(JSON.stringify(pkg)).not.toMatch(/[\^~]\d/);
    expect(existsSync(resolve(spikeDir, "pnpm-lock.yaml"))).toBe(true);
    const workspace = readFileSync(resolve(spikeDir, "../../pnpm-workspace.yaml"), "utf8");
    expect(workspace).not.toContain("spikes");
  });
});
