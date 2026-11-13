import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evalCommand } from "../src/eval.ts";

const fx = (name: string): string => join(import.meta.dirname, "fixtures", "eval", name);
const baseline = fx("baseline.json");

describe("friday eval", () => {
  it("prints the summary and exits 0 when there is no regression", () => {
    const out = evalCommand(["eval", "--input", fx("runs-pass.json"), "--baseline", baseline]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("Taxa de Done: 75%");
  });

  it("exits 1 and names the drop when the done rate regresses", () => {
    const out = evalCommand(["eval", "--input", fx("runs-regress.json"), "--baseline", baseline]);
    expect(out.code).toBe(1);
    expect(out.stdout).toContain("Regressão: taxa de Done caiu de 75% para 50%");
  });

  it("exits 2 with a pt-BR reason for missing or invalid input", () => {
    const usage = "Uso: friday eval --input <arquivo> --baseline <arquivo>\n";
    const none = evalCommand(["eval"]);
    expect(none).toEqual({ stdout: "", stderr: usage, code: 2 });
    const missing = evalCommand(["eval", "--input", fx("nope.json"), "--baseline", baseline]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("não foi possível ler");
    expect(missing.stderr).not.toContain("at ");
    const bad = evalCommand(["eval", "--input", fx("runs-invalid.json"), "--baseline", baseline]);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("inválido");
  });
});
