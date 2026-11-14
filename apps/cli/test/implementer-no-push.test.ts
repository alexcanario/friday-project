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

const step1Line =
  "1. Normal mode only (the prompt has no PR `head_sha`): `git fetch origin develop && git switch -c friday/<n>-<slug> origin/develop`. In fix mode skip this step.";
const fixIntro =
  "The prompt brings the `branch` and the `head_sha` of an existing PR. In fix mode this block overrides step 1, the `pr_title`/`pr_body` part of step 5, and step 6.";
const fixHeading = "## Fix mode";
const fixSkipStep1 =
  "- Do not run step 1: never create a branch and never switch branches; work on the received checkout.";
const fixCheckHead =
  '- Check that `git rev-parse HEAD` equals the received `head_sha`; if not, return {"status": "needs-human", "reason": "checkout is not the PR head"}.';
const fixTestFirst =
  "- When the fix changes behavior, write the failing test first and commit it; then implement and run step 4.";
const fixHistory =
  "- Commit on top of the PR head (detached HEAD) and never rewrite history: no amend, no rebase, no reset. The commit message follows step 5.";
const fixReturn =
  '- Return {"status": "committed", "branch": "<the received branch>", "head_sha": "<the new head>", "pr_title": "", "pr_body": ""}: the PR already exists.';
const fixFailed =
  "- If still red after 2 attempts: commit what you have and return status `failed` with the received `branch`, the new `head_sha` and `diagnosis`, without a new `pr_title` or `pr_body`.";

const unconditionalStep1 = (line: string): boolean =>
  line.startsWith("1. ") && line.includes("git switch -c") && !line.includes("Normal mode only");

function fixModeOk(body: string): boolean {
  const lines = body.split(/\r?\n/);
  const block = section(body, fixHeading);
  return (
    lines.includes(step1Line) &&
    !lines.some(unconditionalStep1) &&
    block.trim() !== "" &&
    block.includes("checkout is not the PR head") &&
    !block.includes("git switch -c") &&
    !block.includes("git checkout -b")
  );
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
      "- A sessão passa ao `implementer`, no prompt, o corpo e as labels da issue e, numa correção da fase C, o nome da branch, o `head_sha` do PR e o motivo (falha do CI, `issues` do QA ou `must_fix` do Judge), com o checkout no head do PR (`git fetch origin && git checkout --detach <head_sha>`), porque ele não roda `gh`.",
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

  it("implementer step 1 runs only in normal mode", () => {
    const lines = bodyOf(implementer()).split(/\r?\n/);
    expect(lines).toContain(step1Line);
    expect(lines.filter(unconditionalStep1)).toEqual([]);
  });

  it("implementer has a Fix mode block with the intro line", () => {
    const block = section(bodyOf(implementer()), fixHeading);
    expect(block.trim()).not.toBe("");
    expect(block.split("\n").find((l) => l.trim() !== "")).toBe(fixIntro);
  });

  it("fix mode skips step 1 and checks HEAD equals head_sha", () => {
    const lines = section(bodyOf(implementer()), fixHeading).split("\n");
    expect(lines).toContain(fixSkipStep1);
    expect(lines).toContain(fixCheckHead);
  });

  it("fix mode writes the failing test first and never rewrites history", () => {
    const lines = section(bodyOf(implementer()), fixHeading).split("\n");
    expect(lines).toContain(fixTestFirst);
    expect(lines).toContain(fixHistory);
  });

  it("fix mode returns the same branch with empty pr_title and pr_body and failed keeps the new head_sha", () => {
    const lines = section(bodyOf(implementer()), fixHeading).split("\n");
    expect(lines).toContain(fixReturn);
    expect(lines).toContain(fixFailed);
  });

  it("git switch -c appears only in step 1", () => {
    const body = bodyOf(implementer());
    const hits = body.split(/\r?\n/).filter((l) => l.includes("git switch -c"));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.startsWith("1. Normal mode only")).toBe(true);
    const block = section(body, fixHeading);
    expect(block.trim()).not.toBe("");
    expect(block).not.toContain("git switch -c");
    expect(block).not.toContain("git checkout -b");
  });

  it("fix mode detector rejects a sheet without the block, with an unconditional step 1, without the HEAD check or with switch -c in the block", () => {
    const good = bodyOf(implementer());
    expect(fixModeOk(good)).toBe(true);
    const noBlock = good.slice(0, good.indexOf(fixHeading));
    expect(fixModeOk(noBlock)).toBe(false);
    const plainStep1 =
      "1. `git fetch origin develop && git switch -c friday/<n>-<slug> origin/develop`";
    expect(fixModeOk(good.replace(step1Line, plainStep1))).toBe(false);
    expect(fixModeOk(good.replace("checkout is not the PR head", "something else"))).toBe(false);
    expect(fixModeOk(`${good}\n- Run git switch -c x.`)).toBe(false);
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
