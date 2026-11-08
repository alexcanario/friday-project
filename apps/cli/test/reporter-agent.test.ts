import { describe, expect, it } from "vitest";
import { readText } from "./helpers.ts";

function declaresNoTools(markdown: string): boolean {
  const lines = markdown.split(/\r?\n/);
  const first = lines.indexOf("---");
  if (first === -1) return false;
  const second = lines.indexOf("---", first + 1);
  if (second === -1) return false;
  const tools = lines.slice(first + 1, second).filter((l) => l.startsWith("tools:"));
  return tools.length === 1 && tools[0] === "tools: []";
}

function bodyOf(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const first = lines.indexOf("---");
  const second = lines.indexOf("---", first + 1);
  return lines.slice(second + 1).join("\n");
}

const forbidden = [
  /\bgh\b/,
  /\bBash\b/,
  /api repos\//,
  /search\/issues/,
  /graphql/i,
  /labels\[\]/,
  /per_page/,
];

const reporter = (): string => readText(".claude/agents/reporter.md");

describe("reporter agent", () => {
  it("reporter declares tools: [] and keeps name and model", () => {
    const text = reporter();
    expect(declaresNoTools(text)).toBe(true);
    const lines = text.split(/\r?\n/);
    expect(lines).toContain("name: reporter");
    expect(lines).toContain("model: haiku");
  });

  it("declaresNoTools rejects missing, Bash and duplicated tools lines and accepts CRLF", () => {
    const wrap = (...fm: string[]): string => ["---", ...fm, "---", "body"].join("\n");
    expect(declaresNoTools(wrap("name: x"))).toBe(false);
    expect(declaresNoTools(wrap("tools: Bash"))).toBe(false);
    expect(declaresNoTools(wrap("tools: Bash(gh api:*)"))).toBe(false);
    expect(declaresNoTools(wrap("tools: [Bash]"))).toBe(false);
    expect(declaresNoTools(wrap("tools: []", "tools: []"))).toBe(false);
    expect(declaresNoTools(wrap("tools: []"))).toBe(true);
    expect(declaresNoTools(wrap("tools: []").replace(/\n/g, "\r\n"))).toBe(true);
  });

  it("reporter body has no gh, Bash or API call and the detector catches one", () => {
    const sample = "run gh api repos/x/y/issues";
    expect(forbidden.some((re) => re.test(sample))).toBe(true);
    const body = bodyOf(reporter());
    for (const re of forbidden) expect(body, String(re)).not.toMatch(re);
  });

  it("reporter title uses the UTC date of phase C", () => {
    const text = reporter();
    expect(text).toContain("## Noite de <data UTC da fase C>");
    expect(text).toContain("The first line of the report is `## Noite de <nightOf>`");
    expect(text).not.toContain("data em que a fase A começou");
  });

  it("reporter body states the JSON contract", () => {
    const body = bodyOf(reporter());
    for (const part of [
      '"report"',
      '"suggestions"',
      "digest_error",
      "phaseC",
      "notes",
      "nightOf",
      "Fase A sem registro",
      "noite suspensa",
      "38 lines",
      "⏳ plugin",
      "retentativas contadas nos resultados",
      "## Siglas",
    ]) {
      expect(body, part).toContain(part);
    }
    for (const part of [
      "Gather the whole night",
      "Write ONE",
      "retro-log",
      "**Sugestões que viraram issue:**",
      "left no note",
    ]) {
      expect(body, part).not.toContain(part);
    }
  });

  it("reporter keeps merges and stuck PRs when the digest fails", () => {
    const body = bodyOf(reporter());
    const hits = body.split(/\r?\n/).filter((l) => l.includes("If `digest` is `null`,"));
    expect(hits).toHaveLength(1);
    for (const part of [
      "digest falhou:",
      "phaseC",
      "stuck",
      "night:stop",
      "Próxima noite",
      "suggestions: []",
    ]) {
      expect(hits[0], part).toContain(part);
    }
  });

  it("reporter, night and night-prompts stay within 300 lines", () => {
    for (const file of [".claude/agents/reporter.md", "docs/night.md", "docs/night-prompts.md"]) {
      expect(readText(file).split(/\r?\n/).length, file).toBeLessThanOrEqual(300);
    }
  });
});
