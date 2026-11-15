import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evalCommand } from "../src/eval.ts";

const fx = (name: string): string => join(import.meta.dirname, "fixtures", "eval", name);
const fixture = fx("variant-runs.json");
const baseline = fx("baseline.json");
const base = ["eval", "--compare", "variants", "--input", fixture];

describe("friday eval --compare variants", () => {
  it("prints one line per variant and exits 0", () => {
    expect(evalCommand(base)).toEqual({
      stdout:
        "generic: Done 75% | Judge na 1ª rodada 50% | Rodadas 2.00 | Custo 2.50 USD | Tempo 250 s | Contexto 40000 tokens\n" +
        "specialists: Done 50% | Judge na 1ª rodada 50% | Rodadas 1.50 | Custo 2.00 USD | Tempo 200 s | Contexto 20000 tokens\n",
      stderr: "",
      code: 0,
    });
  });

  it("filters by kind and prints unknown context", () => {
    expect(evalCommand([...base, "--kind", "cross"])).toEqual({
      stdout:
        "generic: Done 0% | Judge na 1ª rodada 0% | Rodadas 4.00 | Custo 4.00 USD | Tempo 400 s | Contexto 70000 tokens\n" +
        "specialists: Done 0% | Judge na 1ª rodada 0% | Rodadas 3.00 | Custo 2.00 USD | Tempo 300 s | Contexto 20000 tokens\n",
      stderr: "",
      code: 0,
    });
    expect(evalCommand([...base, "--kind", "backend"])).toEqual({
      stdout:
        "generic: Done 100% | Judge na 1ª rodada 67% | Rodadas 1.33 | Custo 2.00 USD | Tempo 200 s | Contexto 30000 tokens\n" +
        "specialists: Done 100% | Judge na 1ª rodada 100% | Rodadas 0.00 | Custo 0.00 USD | Tempo 100 s | Contexto ? tokens\n",
      stderr: "",
      code: 0,
    });
  });

  it("exits 2 with a pt-BR reason for invalid usage or input", () => {
    const err = (args: string[], stderr: string): void =>
      expect(evalCommand(args)).toEqual({ stdout: "", stderr, code: 2 });
    err(
      ["eval", "--compare", "variants"],
      "Uso: friday eval --compare variants --input <arquivo> [--kind backend|frontend|cross]\n",
    );
    err(
      ["eval", "--compare", "outro", "--input", fixture],
      "Erro: valor inválido para --compare: outro\n",
    );
    err([...base, "--kind", "devops"], "Erro: valor inválido para --kind: devops\n");
    err(["eval", "--input", fixture, "--kind", "cross"], "Erro: --kind exige --compare variants\n");
    err([...base, "--baseline", baseline], "Erro: --baseline não se aplica a --compare variants\n");
    for (const input of [fx("nope.json"), fx("variant-runs-invalid.json")]) {
      const out = evalCommand(["eval", "--compare", "variants", "--input", input]);
      expect(out.code).toBe(2);
      expect(out.stdout).toBe("");
      expect(out.stderr.startsWith("Erro:")).toBe(true);
      expect(out.stderr).not.toContain("at ");
    }
  });

  it("keeps the baseline mode unchanged", () => {
    const ok = evalCommand(["eval", "--input", fx("runs-pass.json"), "--baseline", baseline]);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("Taxa de Done: 75%");
    const reg = evalCommand(["eval", "--input", fx("runs-regress.json"), "--baseline", baseline]);
    expect(reg.code).toBe(1);
    expect(reg.stdout).toContain("Regressão: taxa de Done caiu de 75% para 50%");
    expect(evalCommand(["eval"])).toEqual({
      stdout: "",
      stderr: "Uso: friday eval --input <arquivo> --baseline <arquivo>\n",
      code: 2,
    });
  });
});
