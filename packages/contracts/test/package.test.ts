import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

describe("package", () => {
  it("declares only zod 4.6.7 and no workspace package", () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"));
    expect(pkg.type).toBe("module");
    expect(pkg.private).toBe(true);
    expect(pkg.dependencies).toEqual({ zod: "4.6.7" });
    expect(JSON.stringify(pkg.devDependencies ?? {})).not.toContain("@friday/");
    const out = execFileSync("pnpm", ["-r", "ls", "--depth", "-1", "--json"], {
      cwd: root,
      encoding: "utf8",
    });
    const names = (JSON.parse(out) as Array<{ name: string }>).map((p) => p.name);
    expect(names).toContain("@friday/contracts");
    for (const n of ["domain", "application", "infrastructure", "daemon", "cli"]) {
      expect(names).toContain(`@friday/${n}`);
    }
  });
});
