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
  const start = text.indexOf(heading);
  const rest = text.slice(start + heading.length);
  const next = rest.search(/^## /m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

describe("FINDINGS.md", () => {
  it("has required sections, command and no secret", () => {
    const text = readFileSync(join(spikeDir, "FINDINGS.md"), "utf8");
    const headings = [
      "## Versões",
      "## O que exige chave de API",
      "## Comando para o dono",
      "## Item 1: validador draft-07",
      "## Item 2: canUseTool em dontAsk",
      "## Siglas",
    ];
    for (const h of headings) expect(text).toContain(h);
    const needles = [
      "0.3.318",
      "2.1.318",
      "node run.ts --repo",
      "pnpm --dir spikes/agent-sdk --ignore-workspace install",
      "--mode canuse",
      "--mode violation",
      "--env-keys",
      "#31",
    ];
    for (const n of needles) expect(text).toContain(n);
    for (const h of ["## Item 1: validador draft-07", "## Item 2: canUseTool em dontAsk"]) {
      const body = section(text, h);
      expect(body.length).toBeGreaterThan(0);
    }

    for (const file of walk(spikeDir)) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(secretPattern);
    }
    expect("sk-" + "ant-abc123").toMatch(secretPattern);
  });
});
