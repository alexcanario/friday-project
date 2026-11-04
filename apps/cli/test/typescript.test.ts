import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { allPackageDirs, readJson, root } from "./helpers.ts";

const cliDir = join(root, "apps/cli");
const tsc = join(root, "node_modules/typescript/bin/tsc");
const tmpDirs: string[] = [];

function tmpProject(parent: string, code: string): string {
  const dir = mkdtempSync(join(parent, "tmp-tsc-"));
  tmpDirs.push(dir);
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      extends: join(root, "tsconfig.base.json"),
      include: ["*.ts"],
    }),
  );
  writeFileSync(join(dir, "a.ts"), code);
  return dir;
}

function runTsc(dir: string): number {
  return (
    spawnSync(process.execPath, [tsc, "--noEmit", "-p", dir], { encoding: "utf8" }).status ?? -1
  );
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("typescript", () => {
  it("accepts valid code and rejects type errors, unchecked index and enum", () => {
    const base = readJson("tsconfig.base.json").compilerOptions;
    for (const k of [
      "strict",
      "noUncheckedIndexedAccess",
      "erasableSyntaxOnly",
      "verbatimModuleSyntax",
      "allowImportingTsExtensions",
    ]) {
      expect(base[k], k).toBe(true);
    }
    expect(base.module).toBe("nodenext");
    expect(base.moduleResolution).toBe("nodenext");

    const tmp = mkdtempSync(join(root, "node_modules/.tmp-"));
    tmpDirs.push(tmp);
    const ok = tmpProject(tmp, "export const a: number = 1;\n");
    expect(runTsc(ok)).toBe(0);
    const bad = [
      'export const a: number = "x";\n',
      "const xs: number[] = []; export const n: number = xs[0];\n",
      "export enum E { A }\n",
    ];
    for (const code of bad) expect(runTsc(tmpProject(tmp, code)), code).not.toBe(0);
  });

  it("every package tsconfig extends the base", () => {
    for (const dir of allPackageDirs()) {
      const cfg = readJson(`${dir}/tsconfig.json`);
      expect(cfg.extends, dir).toBe("../../tsconfig.base.json");
    }
  });

  it("resolves @friday/domain through the workspace link and rejects unknown modules", () => {
    expect(readdirSync(cliDir)).toContain("package.json");
    const ok = tmpProject(cliDir, 'import type {} from "@friday/domain";\n');
    expect(runTsc(ok)).toBe(0);
    const bad = tmpProject(cliDir, 'import type {} from "@friday/inexistente";\n');
    expect(runTsc(bad)).not.toBe(0);
  });
});
