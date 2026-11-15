import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), "utf8");

describe("main wiring", () => {
  it("main passes project and baseUrl to App", () => {
    const main = read("../src/main.tsx");
    expect(main).toContain("projectFromSearch(window.location.search)");
    expect(main).toContain("project={project}");
    expect(main).toContain("baseUrl={baseUrl}");
    expect(main).toContain("import.meta.env.VITE_FRIDAY_API_BASE");
    expect(main).toContain("createApiClient(");
  });

  it("keeps fixed origins out of main and project-param", () => {
    for (const file of ["../src/main.tsx", "../src/project-param.ts"]) {
      const src = read(file);
      expect(src).not.toMatch(/127\.0\.0\.1|localhost|7777/);
    }
  });
});
