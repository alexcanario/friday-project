import { describe, expect, it } from "vitest";
import { readText } from "./helpers.ts";

describe("night rules", () => {
  it("reads the risk of the issue before choosing the judge", () => {
    const lines = readText("docs/night.md").split("\n");
    const judge = lines.findIndex((l) => l.startsWith("   3. Judge:"));
    const decide = lines.findIndex((l) => l.startsWith("   4. Decidir"));
    expect(judge).toBeGreaterThan(-1);
    expect(judge).toBeLessThan(decide);
    for (const part of [
      "`- risco:`",
      "`judge-strong`",
      "se a linha faltar",
      "no mesmo `head_sha`",
    ]) {
      expect(lines[judge], part).toContain(part);
    }
    expect(readText("docs/night.md")).not.toMatch(/judge-strong. se houver gate ou risco/);
  });

  it("keeps the docs and agents on the same rule", () => {
    expect(readText("docs/process.md")).toContain("risco ≥ medium ou risco não declarado");
    for (const agent of ["judge", "judge-strong"]) {
      expect(readText(`.claude/agents/${agent}.md`).split("\n")[2]).toContain("no declared risk");
    }
  });
});

function phaseCStep3(): string {
  const lines = readText("docs/night.md").split(/\r?\n/);
  const phase = lines.findIndex((l) => l.startsWith("## Fase C"));
  const start = lines.findIndex((l, i) => i > phase && l.startsWith("3. "));
  const end = lines.findIndex((l) => l.startsWith("## Notas para o Agile e o Lens"));
  expect(phase).toBeGreaterThan(-1);
  expect(start).toBeGreaterThan(phase);
  expect(end).toBeGreaterThan(start);
  return lines.slice(start, end).join("\n");
}

describe("night phase C step 3", () => {
  it("phase C step 3 runs the digest from the main session", () => {
    const step = phaseCStep3();
    for (const part of [
      "git fetch origin develop && git switch --detach origin/develop",
      "Se `node_modules` não existir",
      "pnpm install --frozen-lockfile",
      "node apps/cli/src/index.ts night digest --report-issue",
      "nightDigestSchema",
      "digest_error",
      "UM comentário",
    ]) {
      expect(step, part).toContain(part);
    }
    for (const part of ["friday night digest", "Ele lê os comentários"]) {
      expect(step, part).not.toContain(part);
    }
    const text = readText("docs/night.md");
    const siglas = text.slice(text.indexOf("## Siglas"));
    expect(siglas).toContain("**PATH:**");
  });

  it("phase C step 3 reads the phase A and B notes since the digest date", () => {
    const step = phaseCStep3();
    for (const part of [
      "Com digest e `since` não nulo",
      "repos/alexcanario/friday-project/issues/<n>/comments?per_page=100&since=<since>&page=<p>",
      "Nunca usar --paginate: o proxy recusa o link da página seguinte (repositories/<id>)",
      `--jq '[.[] | select(.created_at > "<since>") | {createdAt: .created_at, body: .body}]'`,
      "Caso contrário `notes` = `[]` (",
    ]) {
      expect(step, part).toContain(part);
    }
    expect(step).not.toContain('issues/<n>/comments?per_page=100&since=<since>"');
  });

  it("phase C step 3 uses the UTC date of phase C as nightOf", () => {
    const step = phaseCStep3();
    for (const part of [
      "date -u +%F",
      "data UTC da fase C",
      "1ª linha `## Noite de <data UTC da fase C>`",
    ]) {
      expect(step, part).toContain(part);
    }
    for (const part of ["data em que a fase A começou", "véspera da fase C"]) {
      expect(step, part).not.toContain(part);
    }
  });

  it("phase C step 3 searches duplicates, caps at 3 and keeps text out of the shell", () => {
    const step = phaseCStep3();
    for (const part of [
      "search/issues?q=repo:alexcanario/friday-project+is:issue+is:open+",
      "no máximo 3",
      "Achou ⇒ só linkar no relatório",
      "Não achou ⇒ criar a issue",
      "Busca falhou ⇒ não criar a issue",
      "-F title=@",
      "-F body=@",
      '-f "labels[]=status:backlog"',
    ]) {
      expect(step, part).toContain(part);
    }
    for (const part of ["-f title=", "-f body="]) {
      expect(step, part).not.toContain(part);
    }
  });

  it("phase C step 3 keeps merges and stuck PRs when the digest or the reporter fails", () => {
    const step = phaseCStep3();
    for (const part of [
      "Código ≠ 0 (ou install falho)",
      "com `digest` = `null` e `digest_error` = 1ª linha não vazia do stderr",
      "mantém os merges e os PRs parados do `phaseC`.",
      "1ª linha `## Noite de",
      "reporter falhou",
      "não criar issue nenhuma",
    ]) {
      expect(step, part).toContain(part);
    }
  });

  it("night-prompts phase C lets the main session post the report", () => {
    const text = readText("docs/night-prompts.md");
    expect(text).not.toContain("posted by");
    const lines = text.split(/\r?\n/);
    expect(lines).toContain(
      "Delegate to the `qa`, `judge` or `judge-strong`, `implementer` (fixes) and `reporter` subagents. The `reporter` has no tools: you run the digest, create the suggestion issues and post the report.",
    );
    expect(lines).toContain(
      "End with the morning report that you post from the JSON returned by `reporter`.",
    );
  });
});
