import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allPackageDirs, readJson, readText, requiredPackages, root } from "./helpers.ts";

describe("workspace", () => {
  it("declares at least the five @friday packages as private ESM with exports", () => {
    const ws = readText("pnpm-workspace.yaml");
    expect(ws).toContain("packages/*");
    expect(ws).toContain("apps/*");
    for (const [name, dir] of Object.entries(requiredPackages)) {
      const pkg = readJson(`${dir}/package.json`);
      expect(pkg.name).toBe(name);
      expect(pkg.type).toBe("module");
      expect(pkg.private).toBe(true);
      expect(pkg.exports).toEqual({ ".": "./src/index.ts" });
      expect(existsSync(join(root, dir, "src/index.ts"))).toBe(true);
    }
  });

  it("pins Node 26, pnpm 12.16.1 and the root scripts", () => {
    expect(readText(".nvmrc").trim()).toBe("26");
    const pkg = readJson("package.json");
    expect(pkg.engines.node).toBe(">=26");
    expect(pkg.packageManager).toBe("pnpm@12.16.1");
    expect(pkg.scripts.typecheck).toBe("pnpm -r typecheck");
    expect(pkg.scripts.lint).toBe("pnpm -r lint");
    expect(pkg.scripts.test).toBe("pnpm -r test");
    expect(readText(".github/workflows/ci.yml")).toMatch(/node-version:\s*26\b/);
  });

  it("every package exposes the same typecheck, lint and test scripts", () => {
    for (const dir of Object.values(requiredPackages)) {
      const { scripts } = readJson(`${dir}/package.json`);
      expect(scripts.typecheck).toBe("tsc --noEmit");
      expect(scripts.lint).toBe("eslint . && prettier --check .");
      expect(scripts.test).toBe("vitest run --passWithNoTests");
    }
  });

  it("pins every external dependency to an exact version", () => {
    const dirs = [".", ...allPackageDirs()];
    const all: Record<string, string> = {};
    for (const dir of dirs) {
      const pkg = readJson(`${dir}/package.json`);
      for (const field of ["dependencies", "devDependencies"]) {
        for (const [name, version] of Object.entries<string>(pkg[field] ?? {})) {
          if (name.startsWith("@friday/")) expect(version).toBe("workspace:*");
          else {
            expect(version, `${dir} ${name}`).toMatch(/^\d+\.\d+\.\d+$/);
            all[name] = version;
          }
        }
      }
    }
    expect(all["typescript"]).toBe("6.0.3");
    expect(all["vitest"]).toBe("5.1.0");
  });

  it("has an empty NOTICE and a README linking the planning docs", () => {
    expect(existsSync(join(root, "NOTICE"))).toBe(true);
    const readme = readFileSync(join(root, "README.md"), "utf8");
    for (const p of [
      "docs/planning/08-implementation-roadmap.md",
      "docs/planning/09-backlog.md",
      "docs/planning/12-target-diagrams.md",
    ]) {
      expect(readme).toContain(p);
    }
  });
});
