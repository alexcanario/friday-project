import { describe, expect, it } from "vitest";
import { isAllowed } from "../src/allowlist.ts";

describe("isAllowed", () => {
  it("matches exact hosts only", () => {
    expect(isAllowed("allowed.test", ["allowed.test"])).toBe(true);
    expect(isAllowed("ALLOWED.test:80", ["allowed.test"])).toBe(true);
    expect(isAllowed("evil.allowed.test", ["allowed.test"])).toBe(false);
    expect(isAllowed("blocked.test", ["allowed.test"])).toBe(false);
    expect(isAllowed("allowed.test", [])).toBe(false);
  });
});
