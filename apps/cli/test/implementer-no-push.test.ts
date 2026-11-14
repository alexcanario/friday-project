import { describe, expect, it } from "vitest";
import { readText } from "./helpers.ts";

function frontmatterLines(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const first = lines.indexOf("---");
  const second = lines.indexOf("---", first + 1);
  return first === -1 || second === -1 ? [] : lines.slice(first + 1, second);
}

function bodyOf(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const first = lines.indexOf("---");
  const second = lines.indexOf("---", first + 1);
  return lines.slice(second + 1).join("\n");
}

function section(text: string, heading: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf(heading);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

const rulePhrase =
  "Never run `git push` and never run `gh`: the main session pushes the branch and opens the PR (D99).";
const returnPhrase =
  'Return JSON: {"status": "committed"|"failed"|"needs-human", "branch": "friday/<n>-<slug>", "head_sha": "...", "pr_title": "...", "pr_body": "...", "diagnosis": "...", "reason": "..."}.';
const failedPhrase =
  'commit what you have and return {"status": "failed", "branch": "friday/<n>-<slug>", "head_sha": "...", "pr_title": "...", "pr_body": "...", "diagnosis": "..."}; the main session pushes it as a draft PR.';
const forbiddenInBody = [/git push/, /\bgh\b/, /pushes and opens/, /push anyway/, /pr-opened/];

const implementer = (): string => readText(".claude/agents/implementer.md");
const night = (): string => readText("docs/night.md");
const phaseBHeading = "## Fase B · Implementar (01:23)";
const phaseCHeading = "## Fase C · Revisar, testar, merge e relatório (05:17)";

function leaksPush(body: string): boolean {
  const rest = body.replace(rulePhrase, "");
  return forbiddenInBody.some((re) => re.test(rest));
}

function hasRule(body: string): boolean {
  return body.includes(rulePhrase);
}

describe("implementer never pushes nor opens the PR", () => {
  it("implementer body forbids push and gh and has no other push or gh text", () => {
    const body = bodyOf(implementer());
    expect(hasRule(body)).toBe(true);
    const rest = body.replace(rulePhrase, "");
    for (const re of forbiddenInBody) expect(rest, String(re)).not.toMatch(re);
  });

  it("implementer description says commits locally, never pushes, keeps name and model", () => {
    const lines = frontmatterLines(implementer());
    const description = lines.filter((l) => l.startsWith("description:"));
    expect(description).toHaveLength(1);
    expect(description[0]).toContain("commits locally");
    expect(description[0]).toContain("never pushes");
    expect(description[0]).not.toContain("opens the PR");
    expect(lines).toContain("name: implementer");
    expect(lines).toContain("model: sonnet");
    expect(lines.some((l) => l.startsWith("tools:"))).toBe(false);
  });

  it("implementer returns committed with branch, head_sha, pr_title, pr_body and failed pushes draft via session", () => {
    const body = bodyOf(implementer());
    expect(body).toContain(returnPhrase);
    expect(body).toContain(failedPhrase);
  });

  it("night phase B pushes and opens the PR from the main session and no phase says pr-opened", () => {
    const phaseB = section(night(), phaseBHeading);
    expect(phaseB).toContain(
      "`committed` ⇒ a sessão principal roda `git push -u origin <branch>`, abre o PR para `develop` com `gh api` e passa a `status:review`",
    );
    expect(phaseB).toContain(
      "- `failed` ⇒ a sessão principal roda `git push -u origin <branch>`, abre o PR rascunho para `develop` com `gh api` e passa a `status:needs-human` + `gate:budget`, com o diagnóstico.",
    );
    expect(phaseB).not.toContain("pr-opened");
    expect(section(night(), phaseCHeading)).not.toContain("pr-opened");
  });

  it("night common rules say the implementer only commits and the session pushes after each fix", () => {
    const common = section(night(), "## Regras comuns (todas as fases)").split("\n");
    expect(common).toContain(
      "- O `implementer` só comita; `git push` e a abertura do PR são da sessão principal (D99). Depois de cada correção, a sessão confere que `git rev-parse HEAD` é igual ao `head_sha` devolvido e roda `git push origin <head_sha>:refs/heads/<branch>` (sem force; funciona em HEAD destacado).",
    );
    expect(common).toContain(
      "- A sessão passa ao `implementer`, no prompt, o corpo e as labels da issue e, numa correção da fase C, o nome da branch e o motivo (falha do CI, `issues` do QA ou `must_fix` do Judge), com o checkout no head do PR (`git fetch origin && git checkout --detach <head_sha>`), porque ele não roda `gh`.",
    );
    expect(common.some((l) => l.startsWith("- A sessão principal lê com `gh api` e passa"))).toBe(
      true,
    );
  });

  it("night phase C fixes are pushed by the session", () => {
    const lines = section(night(), phaseCHeading).split("\n");
    const phrase = "correção pelo `implementer` e push pela sessão";
    const wanted = [
      lines.find((l) => l.startsWith("   1. Esperar o CI")),
      lines.find((l) => l.startsWith("   2. Subagente")),
      lines.find((l) => l.startsWith("      - Judge") && l.includes("request_changes")),
    ];
    for (const line of wanted) {
      expect(line).toBeDefined();
      expect(line).toContain(phrase);
    }
  });

  it("process and diagrams no longer say the implementer opens the PR", () => {
    const process = readText("docs/process.md");
    expect(process).toContain(
      "Testes primeiro, código, CI local, commit (push e PR são da sessão principal).",
    );
    expect(process).not.toContain("CI local, PR.");
    const diagrams = readText("docs/diagrams.md");
    expect(diagrams).not.toContain('IM->>GH: branch, testes, código, PR "Closes #n"');
    expect(diagrams).not.toContain("IM-->>O: pr-opened, head_sha");
    const lines = diagrams.split(/\r?\n/).map((l) => l.trim());
    const at = lines.indexOf("IM-->>O: committed, head_sha");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines[at + 1]).toBe('O->>GH: git push, PR "Closes #n"');
  });

  it("detector rejects a sheet with git push or pr-opened and a sheet without the rule; changed files stay within 300 lines", () => {
    expect(leaksPush(`${rulePhrase}\nRun git push origin x.`)).toBe(true);
    expect(leaksPush(`${rulePhrase}\nreturn pr-opened`)).toBe(true);
    expect(leaksPush(rulePhrase)).toBe(false);
    expect(hasRule("body without the rule")).toBe(false);
    expect(
      hasRule(`intro
${rulePhrase}`),
    ).toBe(true);
    const files = [
      ".claude/agents/implementer.md",
      "docs/night.md",
      "docs/process.md",
      "docs/diagrams.md",
      "apps/cli/test/implementer-no-push.test.ts",
    ];
    for (const file of files) {
      expect(readText(file).split(/\r?\n/).length, file).toBeLessThanOrEqual(300);
    }
  });
});
