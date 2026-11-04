import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJson, readText, root } from "./helpers.ts";

describe("domain purity", () => {
  it("keeps the domain free of external imports", () => {
    const pkg = readJson("packages/domain/package.json");
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies).toBeUndefined();

    const dir = join(root, "packages/domain/src");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      const text = readText(`packages/domain/src/${file}`);
      const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
        (m) => m[1],
      );
      for (const spec of specs) expect(spec, `${file} imports ${spec}`).toMatch(/^\.\.?\//);
    }
  });
});
