import { CONTEXT_AREAS } from "@friday/application";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readContextPack } from "../src/index.ts";

const registry = resolve(import.meta.dirname, "../../../registry");
const headings = ["## Regras", "## Padrões", "## Ferramentas", "## Modelo"];

function sectionBody(text: string, heading: string): string[] {
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return end < 0 ? rest : rest.slice(0, end);
}

describe("context packs in the registry", () => {
  it("reads each pack with its four sections and returns null when missing", () => {
    for (const area of CONTEXT_AREAS) {
      const text = readContextPack(registry, area);
      expect(text).not.toBeNull();
      const pack = text as string;
      for (const heading of headings) {
        expect(sectionBody(pack, heading).some((l) => l.trim() !== "")).toBe(true);
      }
      expect(sectionBody(pack, "## Modelo").filter((l) => l.startsWith("```")).length).toBeGreaterThanOrEqual(2);
      expect(pack.split("\n").length).toBeLessThanOrEqual(300);
      expect(pack).not.toMatch(/sk-ant-|ghp_|github_pat_/);
    }
    expect(readContextPack(registry, "frontend")).toContain("Blazor");
    const empty = mkdtempSync(join(tmpdir(), "context-packs-"));
    try {
      expect(readContextPack(empty, "backend")).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
