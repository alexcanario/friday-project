import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { root } from "./helpers.ts";

const fixtures = "apps/cli/test/fixtures/eval";

function run(...args: string[]) {
  const r = spawnSync(process.execPath, ["apps/cli/src/index.ts", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status };
}

function evalArgs(runs: string): string[] {
  return ["eval", "--input", `${fixtures}/${runs}`, "--baseline", `${fixtures}/baseline.json`];
}

describe("friday eval routing", () => {
  it("dispatches eval to evalCommand and exits 0 when there is no regression", () => {
    const r = run(...evalArgs("runs-pass.json"));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Taxa de Done: 75%");
  }, 30_000);

  it("dispatches eval and exits 1 on a done-rate regression", () => {
    const r = run(...evalArgs("runs-regress.json"));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("Regressão: taxa de Done caiu de 75% para 50%");
  }, 30_000);

  it("prints the eval usage and exits 2 without flags", () => {
    expect(run("eval")).toEqual({
      stdout: "",
      stderr: "Uso: friday eval --input <arquivo> --baseline <arquivo>\n",
      code: 2,
    });
  }, 30_000);

  it("rejects an unknown flag through the real entrypoint", () => {
    expect(run(...evalArgs("runs-pass.json"), "--verbose", "1")).toEqual({
      stdout: "",
      stderr: "Erro: flag desconhecida: --verbose\n",
      code: 2,
    });
  }, 30_000);

  it("does not route a non-eval subcommand to evalCommand", () => {
    const r = run("evaluate");
    expect(r.code).toBe(2);
    expect(r.stderr).toBe("Uso: friday config check --root <pasta>\n");
  }, 30_000);
});
