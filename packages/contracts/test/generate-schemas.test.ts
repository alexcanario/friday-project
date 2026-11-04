import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../scripts/generate-schemas.ts");
const committed = resolve(import.meta.dirname, "../../../contracts");
const norm = (s: string) => s.replaceAll("\r\n", "\n");

function sameAsCommitted(dir: string) {
  const files = readdirSync(dir).sort();
  expect(files).toHaveLength(6);
  expect(files).toEqual(readdirSync(committed).sort());
  for (const f of files) {
    const text = norm(readFileSync(join(dir, f), "utf8"));
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toBe(norm(readFileSync(join(committed, f), "utf8")));
  }
}

describe("generate-schemas", () => {
  it("regenerates the committed files", () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"));
    expect(pkg.scripts["generate:schemas"]).toBe("node scripts/generate-schemas.ts");
    const out = mkdtempSync(join(tmpdir(), "schemas-"));
    execFileSync(process.execPath, [script, "--out", out]);
    sameAsCommitted(out);
    const cwd = mkdtempSync(join(tmpdir(), "cwd-"));
    execFileSync(process.execPath, [script], { cwd });
    sameAsCommitted(committed);
  });
});
