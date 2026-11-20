import { describe, expect, it } from "vitest";
import { isPanelTokenFormatValid, PANEL_TOKEN_MIN_LENGTH } from "../src/index.ts";

const VALID = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6";

describe("panel token format", () => {
  it("accepts only letters and digits with at least 32 characters", () => {
    expect(PANEL_TOKEN_MIN_LENGTH).toBe(32);
    expect(isPanelTokenFormatValid(VALID)).toBe(true);
    expect(isPanelTokenFormatValid("aB3".repeat(21) + "x")).toBe(true);
    expect(isPanelTokenFormatValid(VALID.slice(0, 31))).toBe(false);
    const base = VALID.slice(0, 31);
    for (const bad of ['"', "\\", " ", "-", "\n", "é"]) {
      expect(isPanelTokenFormatValid(base + bad), JSON.stringify(bad)).toBe(false);
      expect(isPanelTokenFormatValid(VALID + bad), JSON.stringify(bad)).toBe(false);
    }
    expect(isPanelTokenFormatValid("")).toBe(false);
  });
});
