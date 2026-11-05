import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isInside } from "../src/index.ts";

describe("isInside", () => {
  it("detects paths inside a root", () => {
    expect(isInside("/work/wt/17", "/work/wt/17/a")).toBe(true);
    expect(isInside("/work/wt/17", "/work/wt/17")).toBe(true);
    expect(isInside("/work/wt/17", "/work/wt/170")).toBe(false);
    expect(isInside("/work/wt/17", "/work/wt/17/../x")).toBe(false);

    const base = mkdtempSync(join(tmpdir(), "friday-guard-"));
    const parent = join(base, "parent");
    mkdirSync(join(parent, "sub"), { recursive: true });
    mkdirSync(join(base, "outside"));
    symlinkSync(join(parent, "sub"), join(base, "outside", "link"));
    expect(isInside(parent, join(base, "outside", "link"))).toBe(true);
    expect(isInside(parent, join(base, "outside", "link", "novo", "arquivo"))).toBe(true);
    expect(isInside(parent, join(base, "outside"))).toBe(false);
  });
});
