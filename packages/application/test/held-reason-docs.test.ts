import { readFileSync } from "node:fs";
import { HELD_REASONS } from "@friday/domain";
import { describe, expect, it } from "vitest";

describe("held reason docs", () => {
  it("documents every held reason in the doc 12 catalogue", () => {
    const doc = readFileSync(
      new URL("../../../docs/planning/12-target-diagrams.md", import.meta.url),
      "utf8",
    );
    for (const reason of HELD_REASONS) {
      expect(doc, reason).toContain(`\`${reason}\``);
    }
    expect(doc).toContain("SpecialistWithoutAgent");
  });
});
