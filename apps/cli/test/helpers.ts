import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const root = resolve(import.meta.dirname, "../../..");

export const requiredPackages: Record<string, string> = {
  "@friday/domain": "packages/domain",
  "@friday/application": "packages/application",
  "@friday/infrastructure": "packages/infrastructure",
  "@friday/daemon": "apps/daemon",
  "@friday/cli": "apps/cli",
};

export function readText(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = { [key: string]: any };

export function readJson(rel: string): Json {
  return JSON.parse(readText(rel));
}

export function allPackageDirs(): string[] {
  const dirs: string[] = [];
  for (const parent of ["packages", "apps"]) {
    const abs = join(root, parent);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      if (existsSync(join(abs, name, "package.json"))) dirs.push(`${parent}/${name}`);
    }
  }
  return dirs;
}
