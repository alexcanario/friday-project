import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFactoryConfig } from "../src/index.ts";
import {
  fixture,
  makeRoot,
  problemsOf,
  removeLine,
  replaceLine,
  write,
  edit,
} from "./config-helpers.ts";

const F = "factory.yaml";
const QA = "agents/qa.yaml";

describe("loadFactoryConfig", () => {
  it("loads the valid fixture", () => {
    const result = loadFactoryConfig(fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.repository.name).toBe("friday-sandbox");
    expect(Object.keys(result.agents)).toHaveLength(7);
    expect(result.agents["qa"]?.max_turns).toBe(40);
  });

  it("reports equal token envs on review_token_env", () => {
    const root = makeRoot();
    edit(root, F, (l) => [
      ...l.slice(0, 22),
      "  author_token_env: FRIDAY_TOKEN",
      "  review_token_env: FRIDAY_TOKEN",
      ...l.slice(22),
    ]);
    expect(problemsOf(root)).toEqual([
      {
        file: F,
        line: 24,
        code: "invalid_value",
        message: "Valor inválido em pull_requests.review_token_env.",
      },
    ]);
  });
  it("reports the exact line of each problem", () => {
    let root = makeRoot();
    edit(root, F, (l) => [...l.slice(0, 28), "extra: 1", ""].filter((x, i) => i < 29 || x !== ""));
    expect(problemsOf(root)).toEqual([
      { file: F, line: 29, code: "unknown_key", message: "Chave não prevista em raiz." },
    ]);

    root = makeRoot();
    edit(root, F, (l) => [...l.slice(0, 28), "1: a", ""]);
    expect(problemsOf(root).map((p) => [p.code, p.line])).toEqual([["unknown_key", 29]]);

    root = makeRoot();
    edit(root, F, (l) => [...l.slice(0, 13), "  max_qa_rounds: 3", ...l.slice(13)]);
    expect(problemsOf(root)).toEqual([
      { file: F, line: 14, code: "unknown_key", message: "Chave não prevista em flow." },
    ]);

    root = makeRoot();
    replaceLine(root, F, 22, "  merge: always");
    expect(problemsOf(root)).toEqual([
      {
        file: F,
        line: 22,
        code: "invalid_value",
        message: "Valor inválido em pull_requests.merge.",
      },
    ]);

    root = makeRoot();
    removeLine(root, F, 6);
    expect(problemsOf(root)).toEqual([
      {
        file: F,
        line: 3,
        code: "required_key",
        message: "Chave obrigatória ausente: repository.base.",
      },
    ]);

    root = makeRoot();
    removeLine(root, QA, 3);
    expect(problemsOf(root)).toEqual([
      {
        file: QA,
        line: 1,
        code: "required_key",
        message: "Chave obrigatória ausente: model.",
      },
    ]);
  });

  it("reports invalid yaml without throwing", () => {
    const cases: Array<[string, number]> = [
      ["a: 1\nb: 2\na: 3\n", 3],
      ["a: 1\n---\nb: 2\n", 2],
      ["a: 1\nb: [x\nc: 2\n", 3],
      ["a: 1\nb: *x\n", 1],
    ];
    for (const [text, line] of cases) {
      const root = makeRoot();
      write(root, F, text);
      expect(problemsOf(root), JSON.stringify(text)).toEqual([
        { file: F, line, code: "yaml_invalid", message: "YAML inválido." },
      ]);
    }
    for (const text of ["", "- a\n"]) {
      const root = makeRoot();
      write(root, F, text);
      expect(problemsOf(root), JSON.stringify(text)).toEqual([
        { file: F, line: 1, code: "invalid_value", message: "Valor inválido em raiz." },
      ]);
    }
  });

  it("reports missing files and sorts problems", () => {
    let root = makeRoot();
    rmSync(join(root, F));
    expect(problemsOf(root)).toEqual([
      { file: F, line: 1, code: "missing_file", message: "Arquivo ausente." },
    ]);

    const agentsMissing = [
      { file: "agents", line: 1, code: "missing_file", message: "Arquivo ausente." },
    ];
    root = makeRoot();
    rmSync(join(root, "agents"), { recursive: true });
    expect(problemsOf(root)).toEqual(agentsMissing);

    root = makeRoot();
    rmSync(join(root, "agents"), { recursive: true });
    mkdirSync(join(root, "agents"));
    expect(problemsOf(root)).toEqual(agentsMissing);

    root = makeRoot();
    rmSync(join(root, "agents"), { recursive: true });
    write(root, "agents/qa.yml", "role: qa\n");
    expect(problemsOf(root)).toEqual(agentsMissing);

    root = makeRoot();
    replaceLine(root, F, 22, "  merge: always");
    removeLine(root, QA, 3);
    expect(problemsOf(root).map((p) => p.file)).toEqual([QA, F]);
  });

  it("reports unknown tools with their line", () => {
    const cases: Array<[number, string, string, number]> = [
      [7, "tools: [Read, WebFetch]", "unknown_tool", 7],
      [9, "  - pr_merge", "unknown_tool", 9],
      [7, "tools: [1]", "unknown_tool", 7],
      [7, "tools: Read", "invalid_value", 7],
    ];
    for (const [at, text, code, line] of cases) {
      const root = makeRoot();
      replaceLine(root, QA, at, text);
      expect(
        problemsOf(root).map((p) => [p.file, p.code, p.line]),
        text,
      ).toEqual([[QA, code, line]]);
    }
    const root = makeRoot();
    replaceLine(root, QA, 7, "tools: [Read, WebFetch]");
    expect(problemsOf(root)[0]?.message).toBe("Ferramenta desconhecida em tools.1.");
  });

  it("rejects a role that differs from the file name", () => {
    let root = makeRoot();
    replaceLine(root, "agents/judge.yaml", 1, "role: qa");
    expect(problemsOf(root)).toEqual([
      {
        file: "agents/judge.yaml",
        line: 1,
        code: "role_mismatch",
        message: "role deve ser igual ao nome do arquivo.",
      },
    ]);
    root = makeRoot();
    replaceLine(root, QA, 1, "role: Qa");
    expect(problemsOf(root).map((p) => [p.code, p.line])).toEqual([["invalid_value", 1]]);
  });

  it("rejects prompt files outside the root", () => {
    const targets: Array<[string, (root: string) => void]> = [
      ["../x.md", (r) => writeFileSync(join(dirname(r), "x.md"), "x")],
      ["a/../../x.md", (r) => writeFileSync(join(dirname(r), "x.md"), "x")],
      ["/etc/passwd", (r) => write(r, "etc/passwd", "x")],
      ["C:/x.md", (r) => write(r, "C:/x.md", "x")],
      ["C:\\x.md", (r) => write(r, "C:\\x.md", "x")],
      ["..\\x.md", (r) => write(r, "..\\x.md", "x")],
      ["prompts/absent.md", () => undefined],
      ["prompts", () => undefined],
    ];
    for (const [target, prepare] of targets) {
      const root = makeRoot();
      prepare(root);
      replaceLine(root, QA, 11, `prompt_file: ${JSON.stringify(target)}`);
      expect(
        problemsOf(root).map((p) => [p.file, p.code, p.line]),
        target,
      ).toEqual([[QA, "prompt_file_invalid", 11]]);
    }
    expect(problemsOf(makeRoot())).toEqual([]);
  });

  it("reports an agent without a state", () => {
    const code = (root: string) => problemsOf(root).map((p) => [p.code, p.line]);
    let root = makeRoot();
    replaceLine(root, QA, 2, "states: []");
    expect(code(root)).toEqual([["agent_without_state", 2]]);
    root = makeRoot();
    replaceLine(root, QA, 2, "states:");
    expect(code(root)).toContainEqual(["agent_without_state", 2]);
    expect(code(root).map((c) => c[0])).not.toContain("required_key");
    root = makeRoot();
    removeLine(root, QA, 2);
    expect(code(root)).toContainEqual(["agent_without_state", 1]);
    expect(code(root).map((c) => c[0])).not.toContain("required_key");
    root = makeRoot();
    replaceLine(root, QA, 2, "states: [Diagnose]");
    expect(code(root)).toEqual([["invalid_value", 2]]);
  });

  it("runs the roster check only on valid agents", () => {
    let root = makeRoot();
    rmSync(join(root, QA));
    replaceLine(root, "agents/judge.yaml", 3, "model: gpt");
    expect(problemsOf(root).map((p) => p.code)).toEqual(["invalid_value"]);

    root = makeRoot();
    rmSync(join(root, QA));
    replaceLine(root, F, 22, "  merge: always");
    expect(problemsOf(root)).toEqual([
      {
        file: "agents",
        line: 1,
        code: "state_without_agent",
        message: "Estado sem agente: QA.",
      },
      {
        file: F,
        line: 22,
        code: "invalid_value",
        message: "Valor inválido em pull_requests.merge.",
      },
    ]);
  });
});
