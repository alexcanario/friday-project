import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(import.meta.dirname, "../src");

describe("web source", () => {
  it("apps/web/src never uses dangerouslySetInnerHTML", () => {
    const files = readdirSync(src, { recursive: true, withFileTypes: true }).filter((e) =>
      e.isFile(),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(join(file.parentPath, file.name), "utf8");
      expect(text, `${file.name} uses dangerouslySetInnerHTML`).not.toContain(
        "dangerouslySetInnerHTML",
      );
    }
  });
});
