import type { Criteria, ExperimentKind, WorkReport } from "@friday/contracts";
import { selectContextPackAreas, type ContextArea } from "./context-packs.ts";
import type { IssueSummary } from "./github-port.ts";

const FILES_HEADING = "## Arquivos prováveis";

/** The single issue whose title starts with `<id>:` (D114 item 2); null for none or several. */
export function sandboxIssueOf(issues: readonly IssueSummary[], id: string): IssueSummary | null {
  const matches = issues.filter((issue) => issue.title.startsWith(`${id}:`));
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function pathOf(line: string): string {
  const item = line.slice(2).trim();
  const withoutNote = item.replace(/\s*\([^)]*\)\s*$/, "");
  return withoutNote.replace(/^`(.*)`$/, "$1").trim();
}

/** Paths listed under `## Arquivos prováveis`, or null when the section is missing. */
export function probableFilesOf(body: string): string[] | null {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === FILES_HEADING);
  if (start === -1) return null;
  const files: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (line.startsWith("- ")) files.push(pathOf(line));
  }
  return files.filter((file) => file !== "");
}

const AREAS_BY_KIND: Record<ExperimentKind, ContextArea[]> = {
  backend: ["backend"],
  frontend: ["frontend"],
  cross: ["backend", "frontend"],
};

/** Context areas of an issue (D113 item 2): from the probable files, else from the kind. */
export function areasOf(kind: ExperimentKind, body: string): ContextArea[] {
  const files = probableFilesOf(body);
  const fromFiles = files === null ? [] : selectContextPackAreas(files);
  return fromFiles.length > 0 ? fromFiles : [...AREAS_BY_KIND[kind]];
}

/** Every criterion is proved by `dotnet test` (D114 item 3). */
export function criteriaFor(claims: readonly string[]): Criteria["criteria"] {
  return claims.map((claim, i) => ({
    index: i + 1,
    claim,
    proof: { kind: "command" as const, command: "dotnet test" },
  }));
}

type PromptInput = {
  issue: IssueSummary;
  criteria: readonly string[];
  contextPacks: readonly { area: ContextArea; text: string }[];
  handoff: { role: string; report: WorkReport } | null;
  feedback: string | null;
};

const bullets = (items: readonly string[]): string =>
  items.length === 0 ? "- nenhum" : items.map((item) => `- ${item}`).join("\n");

function handoffSection(handoff: { role: string; report: WorkReport }): string {
  const { report } = handoff;
  return [
    `## Relatório do ${handoff.role}`,
    `Resumo: ${report.summary}`,
    `Commit: ${report.headSha}`,
    `Arquivos alterados:\n${bullets(report.changedFiles)}`,
    `Não feito:\n${bullets(report.notDone)}`,
  ].join("\n");
}

export function specialistPrompt(input: PromptInput): string {
  const { issue } = input;
  const sections = [
    `Issue #${issue.number}: ${issue.title}`,
    issue.body,
    `Critérios de aceite:\n${input.criteria.map((claim, i) => `${i + 1}. ${claim}`).join("\n")}`,
    ...input.contextPacks.map((pack) => `## Pacote de contexto: ${pack.area}\n${pack.text}`),
  ];
  if (input.handoff !== null) sections.push(handoffSection(input.handoff));
  if (input.feedback !== null) sections.push(`Feedback da rodada anterior:\n${input.feedback}`);
  return sections.join("\n\n");
}
