#!/usr/bin/env node
import { loadFactoryConfig } from "@friday/infrastructure";

const USAGE = "Uso: friday config check --root <pasta>\n";

function plural(count: number): string {
  return count === 1 ? "1 problema" : `${count} problemas`;
}

function parseRoot(args: string[]): string | null {
  if (args[0] !== "config" || args[1] !== "check" || args[2] !== "--root") return null;
  const root = args[3];
  return root === undefined || root === "" || args.length !== 4 ? null : root;
}

export function main(args: string[]): { stdout: string; stderr: string; code: number } {
  const root = parseRoot(args);
  if (root === null) return { stdout: "", stderr: USAGE, code: 2 };
  const result = loadFactoryConfig(root);
  if (result.ok) return { stdout: "0 problemas\n", stderr: "", code: 0 };
  const lines = result.problems.map((p) => `${p.file}:${p.line}: ${p.code}: ${p.message}`);
  return {
    stdout: [...lines, plural(result.problems.length)].join("\n") + "\n",
    stderr: "",
    code: 1,
  };
}

const out = main(process.argv.slice(2));
process.stdout.write(out.stdout);
process.stderr.write(out.stderr);
process.exitCode = out.code;
