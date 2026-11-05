import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("persistence ports", () => {
  it("keeps the ports free of io", () => {
    const source = readFileSync(new URL("../src/persistence-ports.ts", import.meta.url), "utf8");
    const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");
    for (const s of specifiers) {
      expect(s).not.toMatch(/^node:|^fs$|better-sqlite3|drizzle-orm/);
    }
    expect(source.length).toBeGreaterThan(0);
  });
});
