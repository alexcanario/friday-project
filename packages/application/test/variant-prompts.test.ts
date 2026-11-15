import { criteriaSchema, type WorkReport } from "@friday/contracts";
import { describe, expect, it } from "vitest";
import {
  areasOf,
  criteriaFor,
  probableFilesOf,
  sandboxIssueOf,
  specialistPrompt,
  type IssueSummary,
} from "../src/index.ts";

const issue = (number: number, title: string, body = "corpo da issue"): IssueSummary => ({
  number,
  title,
  body,
  labels: [],
});

const withFiles = (files: string[]): string =>
  `## Resumo\nx\n\n## Arquivos prováveis\n${files.map((f) => `- ${f}`).join("\n")}\n\n## Risco\nbaixo\n`;

const REPORT: WorkReport = {
  summary: "Endpoint criado",
  headSha: "a".repeat(40),
  changedFiles: ["src/Api/Orders.cs", "src/Api/Health.cs"],
  notDone: ["Tela pendente"],
};

describe("sandboxIssueOf", () => {
  it("finds the sandbox issue by the id prefix of its title", () => {
    const e1 = issue(1, "E1: GET /health");
    const issues = [e1, issue(2, "E2: Validar CPF")];
    expect(sandboxIssueOf(issues, "E1")).toBe(e1);
    expect(sandboxIssueOf(issues, "E3")).toBeNull();
    expect(sandboxIssueOf([issue(3, "E10: outra")], "E1")).toBeNull();
    expect(sandboxIssueOf([issue(4, "XE1: outra")], "E1")).toBeNull();
    expect(sandboxIssueOf([issue(5, "E1 sem dois pontos")], "E1")).toBeNull();
    expect(sandboxIssueOf([e1, issue(6, "E1: duplicada")], "E1")).toBeNull();
  });
});

describe("probableFilesOf and areasOf", () => {
  it("reads probable files and picks the context areas", () => {
    const body = withFiles(["src/Api/Orders.cs", "src/Pages/Home.razor"]);
    expect(probableFilesOf(body)).toEqual(["src/Api/Orders.cs", "src/Pages/Home.razor"]);
    expect(probableFilesOf("## Resumo\nsem a seção\n")).toBeNull();
    expect(areasOf("backend", body)).toEqual(["backend", "frontend"]);
    expect(areasOf("cross", "sem a seção")).toEqual(["backend", "frontend"]);
    expect(areasOf("frontend", "sem a seção")).toEqual(["frontend"]);
    expect(areasOf("backend", withFiles(["README.md"]))).toEqual(["backend"]);
  });

  it("ignores a trailing note after the path and stops at the next section", () => {
    const body = withFiles(["src/Api/Orders.cs (somente leitura)"]);
    expect(probableFilesOf(body)).toEqual(["src/Api/Orders.cs"]);
    expect(probableFilesOf("## Arquivos prováveis\n- a.cs\n## Risco\n- b.cs\n")).toEqual(["a.cs"]);
  });
});

describe("criteriaFor", () => {
  it("turns claims into criteria with the dotnet test proof", () => {
    const proof = { kind: "command", command: "dotnet test" };
    expect(criteriaFor(["a", "b"])).toEqual([
      { index: 1, claim: "a", proof },
      { index: 2, claim: "b", proof },
    ]);
    expect(criteriaSchema.safeParse({ criteria: criteriaFor(["a", "b"]) }).success).toBe(true);
    expect(criteriaFor([])).toEqual([]);
  });
});

describe("specialistPrompt", () => {
  const base = {
    issue: issue(7, "E1: GET /health", "Corpo do pedido"),
    criteria: ["Responde 200", "Corpo ok"],
    contextPacks: [],
    handoff: null,
    feedback: null,
  };

  it("builds the specialist prompt with packs, handoff and feedback", () => {
    const plain = specialistPrompt(base);
    expect(plain).toContain("Issue #7: E1: GET /health");
    expect(plain).toContain("Corpo do pedido");
    expect(plain).toContain("1. Responde 200");
    expect(plain).toContain("2. Corpo ok");
    expect(plain).not.toContain("## Pacote de contexto");
    expect(plain).not.toContain("## Relatório do");
    expect(plain).not.toContain("Feedback da rodada anterior:");

    const packs = specialistPrompt({
      ...base,
      contextPacks: [
        { area: "backend", text: "TEXTO-BACK" },
        { area: "frontend", text: "TEXTO-FRONT" },
      ],
    });
    const back = packs.indexOf("## Pacote de contexto: backend");
    const front = packs.indexOf("## Pacote de contexto: frontend");
    expect(back).toBeGreaterThan(-1);
    expect(front).toBeGreaterThan(back);
    expect(packs).toContain("TEXTO-BACK");
    expect(packs).toContain("TEXTO-FRONT");

    const handoff = specialistPrompt({ ...base, handoff: { role: "backend", report: REPORT } });
    expect(handoff).toContain("## Relatório do backend");
    expect(handoff).toContain("Endpoint criado");
    expect(handoff).toContain("a".repeat(40));
    expect(handoff).toContain("src/Api/Orders.cs");
    expect(handoff).toContain("src/Api/Health.cs");
    expect(handoff).toContain("Tela pendente");

    expect(specialistPrompt({ ...base, feedback: "ajustar" })).toContain(
      "Feedback da rodada anterior:\najustar",
    );
  });
});
