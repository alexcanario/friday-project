import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("pnpm workspace", () => {
  it("stays out of the pnpm workspace", () => {
    const text = readFileSync(resolve(import.meta.dirname, "../../../pnpm-workspace.yaml"), "utf8");
    expect(text).not.toContain("spikes");
    const globs = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).replace(/["']/g, ""));
    expect(globs).toEqual(["packages/*", "apps/*"]);
  });
});
