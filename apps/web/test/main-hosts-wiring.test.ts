import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("main hosts wiring", () => {
  it("main loads the hosts and keeps the existing wiring", () => {
    const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
    expect(main).toContain("loadHosts(");
    expect(main).toContain("import.meta.env.VITE_FRIDAY_API_BASE");
  });
});
