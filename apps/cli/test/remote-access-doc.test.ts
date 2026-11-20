import { readFileSync } from "node:fs";
import { DEFAULT_ATTEMPT_LIMIT, PANEL_TOKEN_MIN_LENGTH } from "@friday/api";
import { describe, expect, it } from "vitest";

const doc = readFileSync(new URL("../../../docs/acesso-remoto.md", import.meta.url), "utf8");
const lines = doc.split("\n").map((line) => line.trimEnd());

function section(title: string): string {
  const start = lines.indexOf(title);
  expect(start, `missing section ${title}`).toBeGreaterThanOrEqual(0);
  const level = title.match(/^#+/)?.[0].length ?? 2;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = lines[i]?.match(/^(#+) /);
    if (m?.[1] !== undefined && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
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
    const evaluation = section("## Login por usuário: avaliação");
    for (const title of ["### Opções", "### Recomendação", "### Quando construir"]) {
      expect(evaluation.split("\n"), title).toContain(title);
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
    const vars = section("## Variáveis do daemon");
    expect(vars).toContain("`/health`");
    expect(vars).toContain("arquivos estáticos");
    expect(vars).toContain("o login do proxy é a única barreira");
    const row = lines.find((line) => line.includes("`Origem não permitida.`")) ?? "";
    expect(row).toContain("OPTIONS");
    expect(row).toContain("preflight");
    const limit = section("### Limite de tentativas");
    expect(limit).toContain("global");
    expect(limit).toContain("para todos");
    expect(limit).toContain("não substitui o login do proxy");
  });

  it("documents the ssh tunnel on another port", () => {
    const tunnel = section("## Túnel SSH em porta diferente");
    expect(tunnel).toContain("ssh -N -L 7778:127.0.0.1:7777");
    expect(tunnel).toContain("FRIDAY_PANEL_ORIGINS=http://127.0.0.1:7778");
    expect(tunnel).toContain("Host não permitido.");
  });

  it("evaluates the three login options against D111 and #500", () => {
    const evaluation = section("## Login por usuário: avaliação");
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
});
