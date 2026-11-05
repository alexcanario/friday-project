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
  it("has required sections, command and no secret", () => {
    const text = readFileSync(join(spikeDir, "FINDINGS.md"), "utf8");
    const headings = [
      "## Versões",
      "## Comando para o dono",
      "## Paradas humanas",
      "## Hooks",
      "## Quem move o Status",
      "## Recomendação D16",
      "## Siglas",
    ];
    for (const h of headings) expect(text).toContain(h);
    for (const n of [
      "0.3.318",
      "node run.ts --plugin",
      "pnpm --dir spikes/agile-plugin --ignore-workspace install",
      "--args=",
      "/agile:autopilot",
      "--env-keys SystemRoot,USERPROFILE,TEMP",
    ]) {
      expect(text).toContain(n);
    }
    for (const h of headings.slice(2, 6)) {
      const body = section(text, h);
      expect(body.length).toBeGreaterThan(0);
    }
    for (const file of walk(spikeDir)) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(secretPattern);
    }
    expect("sk-" + "ant-abc123").toMatch(secretPattern);
  });
});
