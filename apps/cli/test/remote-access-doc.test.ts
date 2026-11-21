import { readFileSync } from "node:fs";
import { DEFAULT_ATTEMPT_LIMIT, PANEL_TOKEN_MIN_LENGTH } from "@friday/api";
import { describe, expect, it } from "vitest";

const doc = readFileSync(new URL("../../../docs/acesso-remoto.md", import.meta.url), "utf8");
const lines = doc.split("\n").map((line) => line.trimEnd());

function section(text: string, title: string): string | null {
  const all = text.split("\n").map((line) => line.trimEnd());
  const start = all.indexOf(title);
  if (start < 0) return null;
  const level = title.match(/^#+/)?.[0].length ?? 2;
  let end = all.length;
  for (let i = start + 1; i < all.length; i += 1) {
    const m = all[i]?.match(/^(#+) /);
    if (m?.[1] !== undefined && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return all.slice(start, end).join("\n");
}

const LIMIT_TITLE = "### Limite de tentativas";
const VARS_TITLE = "## Variáveis do daemon";
const OLD_LIMIT_SENTENCE = "a todos os pedidos, menos `/health`, até a janela terminar";
const LIMIT_TEXTS = [
  "o preflight (`OPTIONS` com `Origin`)",
  "`204`",
  "Origem não permitida.",
  "o `429` vale para os demais pedidos",
  "conta como recusa",
];
const VARS_TEXTS = [
  "Sem `FRIDAY_PANEL_TOKEN` e sem `FRIDAY_PANEL_ORIGINS`",
  "a leitura aberta",
  "sem exigir token",
  "Aprovar e rejeitar continuam recusados com `401` e `Token do painel inválido.`",
];

/** The C6 and C7 texts missing from their sections of `text`, plus the old C6 sentence if present. */
function missingDocTexts(text: string): string[] {
  const missing: string[] = [];
  const limit = section(text, LIMIT_TITLE);
  for (const t of LIMIT_TEXTS) if (limit === null || !limit.includes(t)) missing.push(t);
  const vars = section(text, VARS_TITLE);
  for (const t of VARS_TEXTS) if (vars === null || !vars.includes(t)) missing.push(t);
  if (text.includes(OLD_LIMIT_SENTENCE)) missing.push(OLD_LIMIT_SENTENCE);
  return missing;
}

describe("remote access guide", () => {
  it("has every section of the remote access guide", () => {
    for (const title of [
      "## Como o painel é exposto",
      "## Variáveis do daemon",
      "## O que o proxy ou túnel gerenciado precisa fazer",
      "## Túnel SSH em porta diferente",
      "## Trocar o token",
      "## Login por usuário: avaliação",
      "## Siglas",
    ]) {
      expect(lines, title).toContain(title);
    }
    const evaluation = section(doc, "## Login por usuário: avaliação");
    expect(evaluation).not.toBeNull();
    for (const title of ["### Opções", "### Recomendação", "### Quando construir"]) {
      expect((evaluation ?? "").split("\n"), title).toContain(title);
    }
  });

  it("names every variable, header and answer text", () => {
    for (const text of [
      "FRIDAY_PANEL_ORIGINS",
      "FRIDAY_PANEL_TOKEN",
      "FRIDAY_PANEL_TOKEN_EXPIRES_AT",
      "x-forwarded-proto",
      "x-friday-token",
      "Muitas tentativas recusadas. Tente de novo em instantes.",
      "Token do painel expirado.",
      "HTTPS obrigatório.",
    ]) {
      expect(doc, text).toContain(text);
    }
  });

  it("states the limit and the token length that the code uses", () => {
    expect(doc).toContain(
      `${DEFAULT_ATTEMPT_LIMIT.maxFailures} recusas em ${DEFAULT_ATTEMPT_LIMIT.windowMs / 1000} s`,
    );
    expect(doc).toContain(`${PANEL_TOKEN_MIN_LENGTH} caracteres`);
  });

  it("says which requests the token covers and what the origin check and the limit do not do", () => {
    const vars = section(doc, VARS_TITLE);
    expect(vars).not.toBeNull();
    expect(vars).toContain("`/health`");
    expect(vars).toContain("arquivos estáticos");
    expect(vars).toContain("o login do proxy é a única barreira");
    const row = lines.find((line) => line.includes("`Origem não permitida.`")) ?? "";
    expect(row).toContain("OPTIONS");
    expect(row).toContain("preflight");
    const limit = section(doc, LIMIT_TITLE);
    expect(limit).not.toBeNull();
    expect(limit).toContain("global");
    expect(limit).toContain("para todos");
    expect(limit).toContain("não substitui o login do proxy");
  });

  it("documents the ssh tunnel on another port", () => {
    const tunnel = section(doc, "## Túnel SSH em porta diferente");
    expect(tunnel).not.toBeNull();
    expect(tunnel).toContain("ssh -N -L 7778:127.0.0.1:7777");
    expect(tunnel).toContain("FRIDAY_PANEL_ORIGINS=http://127.0.0.1:7778");
    expect(tunnel).toContain("Host não permitido.");
  });

  it("evaluates the three login options against D111 and #500", () => {
    const evaluation = section(doc, "## Login por usuário: avaliação");
    expect(evaluation).not.toBeNull();
    expect(evaluation).toContain("D111");
    expect(evaluation).toContain("#500");
    for (const label of [
      "Token único com o login do proxy",
      "Login por usuário na API",
      "Login por usuário no proxy com identidade repassada",
    ]) {
      expect(evaluation, label).toContain(label);
    }
    const last = lines.filter((line) => line.startsWith("## ")).at(-1);
    expect(last).toBe("## Siglas");
  });

  it("says what the preflight gets when the limit is reached", () => {
    expect(section(doc, LIMIT_TITLE)).not.toBeNull();
    const missing = missingDocTexts(doc).filter(
      (t) => LIMIT_TEXTS.includes(t) || t === OLD_LIMIT_SENTENCE,
    );
    expect(missing).toEqual([]);
  });

  it("says what the panel does without a token", () => {
    expect(section(doc, VARS_TITLE)).not.toBeNull();
    const missing = missingDocTexts(doc).filter((t) => VARS_TEXTS.includes(t));
    expect(missing).toEqual([]);
    expect(missingDocTexts(doc)).toEqual([]);
  });

  it("the doc check fails when the new sentences are missing", () => {
    let copy = doc;
    for (const t of [...LIMIT_TEXTS, ...VARS_TEXTS]) copy = copy.replaceAll(t, "");
    const missing = missingDocTexts(copy);
    for (const t of [...LIMIT_TEXTS, ...VARS_TEXTS]) expect(missing, t).toContain(t);
    expect(missingDocTexts(copy.replaceAll("### Limite de tentativas", ""))).toEqual(
      expect.arrayContaining(LIMIT_TEXTS),
    );
  });
});
