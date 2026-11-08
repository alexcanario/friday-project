import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sectionOf, validateFindings } from "../src/validate.ts";

const spikeDir = resolve(import.meta.dirname, "..");
const rootDir = resolve(spikeDir, "../..");
const secretPattern = /sk-ant-[A-Za-z0-9_-]+/;
const findings = () => readFileSync(join(spikeDir, "FINDINGS.md"), "utf8");

const headings = [
  "## Pergunta 1",
  "## Pergunta 2",
  "## Pergunta 3",
  "## Versões fixadas",
  "## Procedimento de medição",
  "## Recomendação",
  "## Siglas",
];

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

function validDoc(decision: string): string {
  return [
    "## Pergunta 1",
    "Resposta com fonte https://example.com/a",
    "Status: testado",
    "",
    "## Pergunta 2",
    "Resposta com fonte https://example.com/b",
    "Status: só lido",
    "",
    "## Pergunta 3",
    "Resposta com fonte https://example.com/c",
    "Status: testado",
    "",
    "## Versões fixadas",
    "- zod 4.6.7",
    "- fastify 5.12.8",
    "- drizzle-orm 0.45.4",
    "- @anthropic-ai/claude-agent-sdk 0.3.318",
    "",
    "## Procedimento de medição",
    "Rodar o implementer duas vezes e comparar.",
    "",
    "## Recomendação",
    `Decisão: ${decision}`,
    "",
    "## Siglas",
    "- MCP: Model Context Protocol.",
    "",
  ].join("\n");
}

describe("FINDINGS.md", () => {
  it("has required sections and none empty", () => {
    const text = findings();
    for (const h of headings) {
      const body = sectionOf(text, h);
      expect(body, h).toBeDefined();
      expect(body!.length, h).toBeGreaterThan(0);
    }
  });

  it("each answer has a URL and a tested or read-only status", () => {
    const text = findings();
    for (const h of headings.slice(0, 3)) {
      const body = sectionOf(text, h) ?? "";
      expect(body, h).toContain("https://");
      expect(body, h).toMatch(/^Status: (testado|só lido)$/m);
    }
  });

  it("pinned versions are recorded", () => {
    const body = sectionOf(findings(), "## Versões fixadas") ?? "";
    for (const v of [
      "zod 4.6.7",
      "fastify 5.12.8",
      "drizzle-orm 0.45.4",
      "@anthropic-ai/claude-agent-sdk 0.3.318",
    ]) {
      expect(body).toContain(v);
    }
  });

  it("recommendation line is usar, não usar or adiar", () => {
    const body = sectionOf(findings(), "## Recomendação") ?? "";
    expect(body.match(/^Decisão: (usar|não usar|adiar)$/gm) ?? []).toHaveLength(1);
  });

  it("has no secret in any file", () => {
    for (const file of walk(spikeDir)) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(secretPattern);
    }
    expect("sk-" + "ant-abc123").toMatch(secretPattern);
  });
});

describe("validateFindings", () => {
  it("validateFindings rejects invalid docs and accepts valid ones", () => {
    const ok = validDoc("usar");
    const invalid = [
      ok.replace("Resposta com fonte https://example.com/b", "Resposta sem fonte"),
      ok.replace("Decisão: usar", "Sem decisão."),
      validDoc("talvez"),
      ok + "\nchave " + "sk-" + "ant-abc123\n",
      ok.replace("## Procedimento de medição\nRodar o implementer duas vezes e comparar.\n\n", ""),
    ];
    for (const text of invalid) {
      expect(text).not.toBe(ok);
      expect(validateFindings(text).length).toBeGreaterThan(0);
    }
    expect(validateFindings(ok)).toEqual([]);
    expect(validateFindings(validDoc("não usar"))).toEqual([]);
    expect(validateFindings(ok.replace(/\n/g, "\r\n"))).toEqual([]);
    expect(validateFindings(findings())).toEqual([]);
  });
});

describe("spike package and CI", () => {
  it("package.json fields", () => {
    const pkg = JSON.parse(readFileSync(join(spikeDir, "package.json"), "utf8"));
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe("module");
    expect(pkg.packageManager).toBe("pnpm@12.16.1");
    expect(pkg.scripts).toEqual({ test: "vitest run" });
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies).toEqual({ vitest: "5.1.0" });
  });

  it("ci.yml job check runs the spike without matrix", () => {
    const text = readFileSync(join(rootDir, ".github/workflows/ci.yml"), "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const start = text.search(/^ {2}check:/m);
    expect(start).toBeGreaterThan(-1);
    const rest = text.slice(start + 1);
    const next = rest.search(/^ {2}[a-z]/m);
    const check = next === -1 ? rest : rest.slice(0, next);
    expect(check).toContain(
      "pnpm --dir spikes/docs-mcp --ignore-workspace install --frozen-lockfile",
    );
    expect(check).toContain("pnpm --dir spikes/docs-mcp test");
    expect(check).not.toContain("strategy:");
    expect(check).not.toContain("matrix");
  });
});
