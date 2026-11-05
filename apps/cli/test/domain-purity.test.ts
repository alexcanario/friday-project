import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJson, root } from "./helpers.ts";

function externalImports(dir: string): string[] {
  const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) =>
    f.endsWith(".ts"),
  );
  const found: string[] = [];
  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8");
    const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
      (m) => m[1] ?? "",
    );
    found.push(...specs.filter((spec) => !/^\.\.?\//.test(spec)));
  }
  return found;
}

describe("domain purity", () => {
  it("keeps the domain free of external imports", () => {
    const pkg = readJson("packages/domain/package.json");
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies).toBeUndefined();
    const dir = join(root, "packages/domain/src");
    expect(readdirSync(dir).filter((f) => f.endsWith(".ts")).length).toBeGreaterThan(1);
    expect(externalImports(dir)).toEqual([]);
  });

  it("finds external imports in nested folders", () => {
    const tmp = mkdtempSync(join(tmpdir(), "purity-"));
    mkdirSync(join(tmp, "sub"));
    writeFileSync(join(tmp, "sub/x.ts"), 'import "lodash";\n');
    expect(externalImports(tmp)).toEqual(["lodash"]);
  });
});
