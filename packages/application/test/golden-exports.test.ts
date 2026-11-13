import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { plantedIdsOf, scoreGolden } from "../src/index.ts";

describe("golden exports", () => {
  it("exports scoring from the package index without importing infrastructure", () => {
    expect(typeof scoreGolden).toBe("function");
    expect(typeof plantedIdsOf).toBe("function");
    for (const f of ["golden-score.ts", "golden-ids.ts"]) {
      const src = readFileSync(resolve(import.meta.dirname, "../src", f), "utf8");
      expect(src).not.toContain("@friday/infrastructure");
    }
  });
});
