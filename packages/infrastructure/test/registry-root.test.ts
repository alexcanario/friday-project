import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRegistryRoot } from "../src/index.ts";

describe("resolveRegistryRoot", () => {
  it("resolves the registry folder", () => {
    expect(resolveRegistryRoot({ env: { FRIDAY_HOME: "/r" }, homeDir: "/h" })).toBe("/r");
    const fallback = join("/h", ".friday", "registry");
    expect(resolveRegistryRoot({ env: {}, homeDir: "/h" })).toBe(fallback);
    expect(resolveRegistryRoot({ env: { FRIDAY_HOME: "" }, homeDir: "/h" })).toBe(fallback);
  });
});
