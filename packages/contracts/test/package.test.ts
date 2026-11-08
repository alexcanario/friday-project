import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

function workspaceNames(base: string): string[] {
  const names: string[] = [];
  for (const group of ["packages", "apps"]) {
    let dirs: string[];
    try {
      dirs = readdirSync(join(base, group), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
    } catch {
      continue;
    }
    for (const dir of dirs) {
      try {
        const pkg = JSON.parse(readFileSync(join(base, group, dir, "package.json"), "utf8"));
        if (typeof pkg.name === "string") names.push(pkg.name);
      } catch {
        continue;
      }
    }
  }
  return names;
}

describe("package", () => {
  it("declares only zod 4.6.7 and no workspace package", () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"));
    expect(pkg.type).toBe("module");
    expect(pkg.private).toBe(true);
    expect(pkg.dependencies).toEqual({ zod: "4.6.7" });
    expect(JSON.stringify(pkg.devDependencies ?? {})).not.toContain("@friday/");
    const names = workspaceNames(root);
    for (const n of ["contracts", "domain", "application", "infrastructure", "daemon", "cli"]) {
      expect(names).toContain(`@friday/${n}`);
    }
  });

  it("workspaceNames ignores a folder without package.json", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ws-"));
    mkdirSync(join(tmp, "packages", "a"), { recursive: true });
    writeFileSync(join(tmp, "packages", "a", "package.json"), '{"name":"@friday/a"}');
    mkdirSync(join(tmp, "apps", "b"), { recursive: true });
    expect(workspaceNames(tmp)).toEqual(["@friday/a"]);
  });
});
