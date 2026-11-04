import { describe, expect, it } from "vitest";
import { resolvePreset } from "../src/presets.ts";

describe("resolvePreset", () => {
  it("resolves every mode", () => {
    expect(resolvePreset("budget")).toMatchObject({ maxTurns: 10, maxBudgetUsd: 0.01 });
    expect(resolvePreset("turns")).toMatchObject({ maxTurns: 1, maxBudgetUsd: 0.5 });
    for (const mode of ["normal", "write", "canuse", "violation"]) {
      expect(resolvePreset(mode)).toMatchObject({ maxTurns: 10, maxBudgetUsd: 0.5 });
    }
    for (const mode of ["normal", "budget", "turns", "write", "canuse", "violation"]) {
      const p = resolvePreset(mode);
      expect(p.exposeWrite).toBe(mode === "write" || mode === "canuse");
      expect(p.withHook).toBe(mode !== "canuse");
      expect(p.prompt.length).toBeGreaterThan(0);
    }
  });

  it("rejects unknown mode", () => {
    expect(() => resolvePreset("x")).toThrow("modo inválido: x");
  });
});
