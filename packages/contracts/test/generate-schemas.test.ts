import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contractJsonSchema } from "../src/json-schema.ts";
import type { ContractKind } from "../src/index.ts";

const kinds: ContractKind[] = [
  "qaReport",
  "reviewVerdict",
  "triage",
  "criteria",
  "workReport",
  "diagnosis",
];
const script = resolve(import.meta.dirname, "../scripts/generate-schemas.ts");
const committed = resolve(import.meta.dirname, "../../../contracts");
const triageFile = join(committed, "triage.schema.json");
const norm = (s: string) => s.replaceAll("\r\n", "\n");
const snapshot = () =>
  Object.fromEntries(
    readdirSync(committed)
      .sort()
      .map((f) => [f, norm(readFileSync(join(committed, f), "utf8"))]),
  );

describe("generate-schemas", () => {
  it("regenerates the committed files", () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"));
    expect(pkg.scripts["generate:schemas"]).toBe("node scripts/generate-schemas.ts");
    const out = mkdtempSync(join(tmpdir(), "schemas-"));
    execFileSync(process.execPath, [script, "--out", out]);
    const files = readdirSync(out).sort();
    expect(files).toHaveLength(6);
    expect(files).toEqual(readdirSync(committed).sort());
    for (const f of files) {
      const text = norm(readFileSync(join(out, f), "utf8"));
      expect(text.endsWith("}\n")).toBe(true);
      expect(text).toBe(norm(readFileSync(join(committed, f), "utf8")));
    }
  });

  it("writes to the default folder from any directory", () => {
    const before = snapshot();
    expect(Object.keys(before)).toHaveLength(6);
    const old = new Date(Date.now() - 60_000);
    utimesSync(triageFile, old, old);
    const mtime = statSync(triageFile).mtimeMs;
    const cwd = mkdtempSync(join(tmpdir(), "cwd-"));
    execFileSync(process.execPath, [script], { cwd });
    expect(snapshot()).toEqual(before);
    expect(statSync(triageFile).mtimeMs).toBeGreaterThan(mtime);
    expect(existsSync(join(cwd, "contracts"))).toBe(false);
  });

  it("rejects out without a value", () => {
    const mtime = statSync(triageFile).mtimeMs;
    for (const args of [["--out"], ["--out", "--x"], ["--out", ""]]) {
      const cwd = mkdtempSync(join(tmpdir(), "cwd-"));
      const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
      expect(r.status, args.join(" ")).toBe(1);
      expect(r.stderr).toContain("Uso: generate-schemas [--out <pasta>]");
      expect(readdirSync(cwd)).toEqual([]);
      expect(statSync(triageFile).mtimeMs).toBe(mtime);
    }
  });

  it("matches the committed schema files", () => {
    for (const kind of kinds) {
      const file = join(committed, `${kind}.schema.json`);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(contractJsonSchema(kind));
    }
  });
});
