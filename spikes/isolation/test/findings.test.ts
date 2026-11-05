import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const spikeDir = resolve(import.meta.dirname, "..");
const secretPattern = /sk-ant-[A-Za-z0-9_-]+/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function section(text: string, heading: string): string {
  const rest = text.slice(text.indexOf(heading) + heading.length);
  const next = rest.search(/^## /m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

describe("FINDINGS.md", () => {
  it("has required sections, commands and no secret", () => {
    const text = readFileSync(join(spikeDir, "FINDINGS.md"), "utf8");
    for (const h of ["## Comandos de teste", "## Resultados", "## O que exige o dono", "## Siglas"]) {
      expect(text).toContain(h);
    }
    for (const needle of ["pnpm --dir spikes/isolation test", "docker run", "node:26-slim", "WSL2", "owner-action"]) {
      expect(text).toContain(needle);
    }
    const results = section(text, "## Resultados");
    for (const id of ["C5", "C6", "C7", "C8"]) {
      expect(results).toMatch(new RegExp(`^.*\\b${id}\\b.*(passou|pendente).*$`, "m"));
    }
    expect(secretPattern.test("sk-" + "ant-abc123")).toBe(true);
    for (const file of walk(spikeDir)) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(secretPattern);
    }
  });
});
