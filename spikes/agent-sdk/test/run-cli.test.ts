import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo } from "./helpers.ts";

const spikeDir = resolve(import.meta.dirname, "..");

function run(args: string[]) {
  return spawnSync(process.execPath, ["run.ts", ...args], {
    cwd: spikeDir,
    env: { PATH: process.env.PATH ?? "" },
    encoding: "utf8",
  });
}

describe("run.ts", () => {
  it("exits 2 without api key", () => {
    const r = run(["--repo", makeRepo(), "--mode", "normal"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("ANTHROPIC_API_KEY ausente");
  });

  it("rejects unknown mode", () => {
    const r = run(["--repo", makeRepo(), "--mode", "x"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("modo inválido: x");
  });

  it("requires --repo", () => {
    const r = run(["--mode", "normal"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--repo ausente");
  });

  it("derives outDir with fileURLToPath so spaces and Windows paths are not percent-encoded", () => {
    const source = readFileSync(resolve(spikeDir, "run.ts"), "utf8");
    expect(source).not.toMatch(/import\.meta\.url\)\.pathname/);
    expect(source).toContain('import { fileURLToPath } from "node:url"');
    expect(source).toContain('fileURLToPath(new URL("./spike", import.meta.url))');
  });
});
