import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadFactoryConfig } from "../src/index.ts";

export const fixture = resolve(import.meta.dirname, "fixtures/valid");

export function makeRoot(): string {
  const parent = mkdtempSync(join(tmpdir(), "friday-config-"));
  const dir = join(parent, "root");
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

export function edit(root: string, file: string, fn: (lines: string[]) => string[]): void {
  const path = join(root, file);
  const lines = readFileSync(path, "utf8").split("\n");
  writeFileSync(path, fn(lines).join("\n"));
}

export function write(root: string, file: string, text: string): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function replaceLine(root: string, file: string, line: number, text: string): void {
  edit(root, file, (l) => l.map((x, i) => (i === line - 1 ? text : x)));
}

export function removeLine(root: string, file: string, line: number): void {
  edit(root, file, (l) => l.filter((_, i) => i !== line - 1));
}

export function problemsOf(root: string) {
  const result = loadFactoryConfig(root);
  return result.ok ? [] : result.problems;
}
