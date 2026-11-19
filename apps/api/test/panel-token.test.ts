import { describe, expect, it } from "vitest";
import { isPanelTokenValid } from "../src/panel-token.ts";

describe("isPanelTokenValid", () => {
  it("compares the token in bytes and fails closed", () => {
    expect(isPanelTokenValid("s3cret", "s3cret")).toBe(true);
    expect(isPanelTokenValid("s3crét", "s3cret")).toBe(false);
    expect(isPanelTokenValid("s3cretX", "s3cret")).toBe(false);
    expect(isPanelTokenValid("", "s3cret")).toBe(false);
    expect(isPanelTokenValid(["s3cret", "s3cret"], "s3cret")).toBe(false);
    expect(isPanelTokenValid(undefined, "s3cret")).toBe(false);
    expect(isPanelTokenValid(42, "s3cret")).toBe(false);
    expect(isPanelTokenValid("s3cret", undefined)).toBe(false);
    expect(isPanelTokenValid("s3cret", "")).toBe(false);
    expect(isPanelTokenValid("", "")).toBe(false);
  });
});
