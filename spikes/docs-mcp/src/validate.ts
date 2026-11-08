export const REQUIRED_HEADINGS = [
  "## Pergunta 1",
  "## Pergunta 2",
  "## Pergunta 3",
  "## Versões fixadas",
  "## Procedimento de medição",
  "## Recomendação",
  "## Siglas",
] as const;

const QUESTION_HEADINGS = REQUIRED_HEADINGS.slice(0, 3);

export const PINNED_VERSIONS = [
  "zod 4.6.7",
  "fastify 5.12.8",
  "drizzle-orm 0.45.4",
  "@anthropic-ai/claude-agent-sdk 0.3.318",
] as const;

const STATUS_LINE = /^Status: (testado|só lido)$/m;
const DECISION_LINE = /^Decisão: (usar|não usar|adiar)$/gm;
const SECRET_PATTERN = /sk-ant-[A-Za-z0-9_-]+/;

/** Body of the section that starts at the exact heading line, up to the next `## ` heading. */
export function sectionOf(text: string, heading: string): string | undefined {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === heading);
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

function headingErrors(text: string): string[] {
  const errors: string[] = [];
  for (const heading of REQUIRED_HEADINGS) {
    const body = sectionOf(text, heading);
    if (body === undefined) errors.push(`falta o cabeçalho "${heading}"`);
    else if (body === "") errors.push(`a seção "${heading}" está vazia`);
  }
  return errors;
}

function questionErrors(text: string): string[] {
  const errors: string[] = [];
  for (const heading of QUESTION_HEADINGS) {
    const body = sectionOf(text, heading) ?? "";
    if (!body.includes("https://"))
      errors.push(`a seção "${heading}" não cita nenhuma URL https://`);
    if (!STATUS_LINE.test(body)) {
      errors.push(`a seção "${heading}" não tem a linha "Status: testado" ou "Status: só lido"`);
    }
  }
  return errors;
}

function versionErrors(text: string): string[] {
  const body = sectionOf(text, "## Versões fixadas") ?? "";
  return PINNED_VERSIONS.filter((version) => !body.includes(version)).map(
    (version) => `a seção "## Versões fixadas" não registra "${version}"`,
  );
}

function decisionErrors(text: string): string[] {
  const body = sectionOf(text, "## Recomendação") ?? "";
  const count = (body.match(DECISION_LINE) ?? []).length;
  if (count === 1) return [];
  return [
    `a seção "## Recomendação" precisa de exatamente uma linha "Decisão: usar|não usar|adiar" (achadas: ${count})`,
  ];
}

/** Returns one pt-BR message per violated rule of the spike #276 findings document; empty when valid. */
export function validateFindings(text: string): string[] {
  const errors = [
    ...headingErrors(text),
    ...questionErrors(text),
    ...versionErrors(text),
    ...decisionErrors(text),
  ];
  if (SECRET_PATTERN.test(text)) errors.push("o texto contém algo que parece uma chave sk-ant-…");
  return errors;
}
