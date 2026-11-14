import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(import.meta.dirname, "../src");

describe("web source", () => {
  it("keeps the API origin out of the web source and reads it from VITE_FRIDAY_API_BASE", () => {
    const files = readdirSync(src, { recursive: true, withFileTypes: true }).filter((e) =>
      e.isFile(),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(join(file.parentPath, file.name), "utf8");
      for (const needle of ["127.0.0.1", "localhost", "7777"]) {
        expect(text, `${file.name} contains ${needle}`).not.toContain(needle);
      }
    }
    const main = readFileSync(join(src, "main.tsx"), "utf8");
    expect(main).toContain("import.meta.env.VITE_FRIDAY_API_BASE");
    expect(main).toContain("createApiClient(");
  });
});
