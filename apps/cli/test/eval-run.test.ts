import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { experimentRunsSchema, type VariantOutcome, type VariantRunner } from "@friday/application";
import { evalCommand } from "../src/eval.ts";
import { runEvalRun, type EvalRunDeps } from "../src/eval-run.ts";
import { root } from "./helpers.ts";

const REGISTRY = join(root, "registry");
const created: string[] = [];
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "friday-547-"));
  created.push(dir);
  return dir;
}

const OUTCOME: VariantOutcome = {
  status: "done",
  costUsd: 0.1,
  rounds: 2,
  judgeFirstRound: true,
  durationS: 10,
  peakContextTokens: 1000,
};

type Setup = { deps: EvalRunDeps; createRunner: ReturnType<typeof vi.fn>; close: () => void };

function setup(over: { registryRoot?: string; runner?: VariantRunner } = {}): Setup {
  const close = vi.fn();
  const runner = over.runner ?? { run: vi.fn(async () => OUTCOME) };
  const createRunner = vi.fn(async () => ({ runner, close }));
  const deps: EvalRunDeps = {
    registryRoot: over.registryRoot ?? REGISTRY,
    createRunner,
    env: {},
    homeDir: "/home/x",
    now: () => 1000,
  };
  return { deps, createRunner, close };
}

const run = (out: string, ...flags: string[]) => [
  "eval",
  "--run",
  "variants",
  "--output",
  out,
  ...flags,
];
const written = (file: string) => JSON.parse(readFileSync(file, "utf8")) as unknown[];

function registryWith(variants: string): string {
  const registryRoot = tmp();
  cpSync(join(REGISTRY, "eval"), join(registryRoot, "eval"), { recursive: true });
  writeFileSync(join(registryRoot, "eval", "variants.json"), variants);
  return registryRoot;
}

describe("friday eval --run variants", () => {
  it("rejects invalid flags and unknown ones", async () => {
    const out = join(tmp(), "x.json");
    const usage = "Uso: friday eval --run variants --output <arquivo> [--repetitions <n>]";
    const conflict = "Erro: --run só aceita --output e --repetitions";
    const cases: [string[], string][] = [
      [["eval", "--run", "outro", "--output", out], "Erro: valor inválido para --run: outro"],
      [["eval", "--run", "variants"], usage],
      [[...run(out), "--repetitions", "0"], "Erro: valor inválido para --repetitions: 0"],
      [[...run(out), "--repetitions", "6"], "Erro: valor inválido para --repetitions: 6"],
      [[...run(out), "--repetitions", "abc"], "Erro: valor inválido para --repetitions: abc"],
      [[...run(out), "--compare", "variants"], conflict],
      [[...run(out), "--input", "x.json"], conflict],
      [[...run(out), "--baseline", "b.json"], conflict],
      [[...run(out), "--kind", "backend"], conflict],
      [[...run(out), "--foo", "x"], "Erro: flag desconhecida: --foo"],
      [["eval", "--run", "variants", "--foo", "x"], "Erro: flag desconhecida: --foo"],
    ];
    for (const [args, message] of cases) {
      const s = setup();
      const result = await runEvalRun(args, s.deps);
      expect(result).toEqual({ stdout: "", stderr: `${message}\n`, code: 2 });
      expect(s.createRunner).not.toHaveBeenCalled();
      expect(existsSync(out)).toBe(false);
    }
  });

  it("runs the whole plan and writes a valid file", async () => {
    const s = setup();
    const out = join(tmp(), "runs.json");
    const result = await runEvalRun(run(out), s.deps);
    expect(result).toEqual({
      stdout: "Execuções: 54\nCusto total: 5.40 USD\nParada pelo teto: não\n",
      stderr: "",
      code: 0,
    });
    const parsed = experimentRunsSchema.safeParse(written(out));
    expect(parsed.success && parsed.data).toHaveLength(54);
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(s.createRunner).toHaveBeenCalledTimes(1);
    const input = s.createRunner.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      registryRoot: REGISTRY,
      env: s.deps.env,
      homeDir: s.deps.homeDir,
      now: s.deps.now,
    });
    expect(input.criteriaById.size).toBe(9);
    expect(input.criteriaById.get("E1")).toHaveLength(4);
    expect(input.criteriaById.get("E1")[0]).toBe("GET /health responde 200");

    const once = join(tmp(), "once.json");
    const single = await runEvalRun(run(once, "--repetitions", "1"), setup().deps);
    expect(single.code).toBe(0);
    expect(written(once)).toHaveLength(27);
  });

  it("the written file is read by friday eval --compare variants", async () => {
    const out = join(tmp(), "runs.json");
    await runEvalRun(run(out), setup().deps);
    const compared = evalCommand(["eval", "--compare", "variants", "--input", out]);
    expect(compared.code).toBe(0);
    const lines = compared.stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.split(":")[0])).toEqual([
      "generic",
      "generic-context",
      "specialists",
    ]);
  });

  it("stops at the 25 USD cap and still exits 0", async () => {
    const runner = { run: vi.fn(async () => ({ ...OUTCOME, costUsd: 5 })) };
    const s = setup({ runner });
    const out = join(tmp(), "runs.json");
    const result = await runEvalRun(run(out), s.deps);
    expect(result).toEqual({
      stdout: "Execuções: 5\nCusto total: 25.00 USD\nParada pelo teto: sim\n",
      stderr: "",
      code: 0,
    });
    expect(written(out)).toHaveLength(5);
    expect(s.close).toHaveBeenCalledTimes(1);
  });

  it("refuses an existing output file", async () => {
    const out = join(tmp(), "runs.json");
    writeFileSync(out, "conteúdo anterior");
    const s = setup();
    const result = await runEvalRun(run(out), s.deps);
    expect(result).toEqual({ stdout: "", stderr: `Erro: o arquivo já existe: ${out}\n`, code: 2 });
    expect(s.createRunner).not.toHaveBeenCalled();
    expect(readFileSync(out, "utf8")).toBe("conteúdo anterior");
  });

  it("refuses a missing or invalid registry file", async () => {
    const empty = tmp();
    const out = join(tmp(), "runs.json");
    const s = setup({ registryRoot: empty });
    const missing = join(empty, "eval", "variants.json");
    expect(await runEvalRun(run(out), s.deps)).toEqual({
      stdout: "",
      stderr: `Erro: não foi possível ler o JSON de ${missing}\n`,
      code: 2,
    });
    expect(s.createRunner).not.toHaveBeenCalled();
    expect(existsSync(out)).toBe(false);

    const bad = registryWith('[{"id":"generic"}]');
    const b = setup({ registryRoot: bad });
    expect(await runEvalRun(run(out), b.deps)).toEqual({
      stdout: "",
      stderr: `Erro: arquivo de configuração inválido: ${join(bad, "eval", "variants.json")}\n`,
      code: 2,
    });
    expect(b.createRunner).not.toHaveBeenCalled();
    expect(existsSync(out)).toBe(false);

    const noIssues = registryWith(readFileSync(join(REGISTRY, "eval", "variants.json"), "utf8"));
    mkdirSync(join(noIssues, "eval"), { recursive: true });
    writeFileSync(join(noIssues, "eval", "experiment-issues.json"), "[]");
    const i = setup({ registryRoot: noIssues });
    const issues = join(noIssues, "eval", "experiment-issues.json");
    expect((await runEvalRun(run(out), i.deps)).stderr).toBe(
      `Erro: arquivo de configuração inválido: ${issues}\n`,
    );
    expect(i.createRunner).not.toHaveBeenCalled();
  });

  describe("reports createRunner errors verbatim and closes the runner", () => {
    const sandboxError =
      "Erro: o experimento só roda no repositório friday-sandbox (configurado: a/b)";

    it.each([[sandboxError], ["O factory.yaml está inválido ou ausente."]])(
      "createRunner rejects with %s",
      async (message) => {
        const s = setup();
        s.createRunner.mockRejectedValueOnce(new Error(message));
        const out = join(tmp(), "runs.json");
        expect(await runEvalRun(run(out), s.deps)).toEqual({
          stdout: "",
          stderr: `${message}\n`,
          code: 2,
        });
        expect(existsSync(out)).toBe(false);
        expect(s.close).not.toHaveBeenCalled();
      },
    );

    it("counts a throwing run as 2 USD, stops at the cap and closes once", async () => {
      const runner = { run: vi.fn(async () => Promise.reject(new Error("falhou"))) };
      const s = setup({ runner });
      const out = join(tmp(), "runs.json");
      const result = await runEvalRun(run(out), s.deps);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Custo total: 26.00 USD");
      expect(result.stdout).toContain("Parada pelo teto: sim");
      const runs = written(out) as { status: string }[];
      expect(runs).toHaveLength(13);
      expect(runs.every((r) => r.status === "failed")).toBe(true);
      expect(s.close).toHaveBeenCalledTimes(1);
    });

    it("reports an unknown variant from runExperiment and closes once", async () => {
      const outra = JSON.stringify([{ id: "outra", title: "Outra", description: "variante" }]);
      const s = setup({ registryRoot: registryWith(outra) });
      const out = join(tmp(), "runs.json");
      expect(await runEvalRun(run(out), s.deps)).toEqual({
        stdout: "",
        stderr: "Erro: variante desconhecida: outra\n",
        code: 2,
      });
      expect(s.close).toHaveBeenCalledTimes(1);
    });
  });
});
