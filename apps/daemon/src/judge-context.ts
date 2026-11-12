import type { StoredEvent } from "@friday/application";
import { qaReportSchema, type QaReport } from "@friday/contracts";
import { criteriaOf } from "./specialist-request.ts";
import { workReportOf } from "./qa-request.ts";

/** Total size of the Judge context, tags included. */
export const JUDGE_CONTEXT_MAX_CHARS = 8000;
export const JUDGE_HOW_MAX_CHARS = 500;
export const JUDGE_NOT_CHECKED_MAX_CHARS = 300;
export const JUDGE_CLAIM_MAX_CHARS = 500;

const TRUNCATED = "[truncado]";
const CLOSING_TAG = /<\/\s*untrusted_data/gi;
const OPEN = (kind: string) => `<untrusted_data kind="${kind}">\n`;
const CLOSE = "\n</untrusted_data>";

type Redact = (text: string) => string;

/** Cuts `text` to `max` characters, the last ones being the truncation marker. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= TRUNCATED.length) return TRUNCATED.slice(0, Math.max(0, max));
  return text.slice(0, max - TRUNCATED.length) + TRUNCATED;
}

/** Redacts secrets, neutralizes the closing delimiter and caps the field. */
function field(text: string, redact: Redact, max: number): string {
  const safe = redact(text).replace(CLOSING_TAG, (m) => `<\\/${m.slice(2).trimStart()}`);
  return safe.length <= max ? safe : safe.slice(0, max) + TRUNCATED;
}

function criteriaText(events: StoredEvent[], redact: Redact): string | null {
  const criteria = criteriaOf(events);
  if (criteria === null || criteria.length === 0) return null;
  return criteria
    .map((c) => {
      const proof = c.proof.kind === "command" ? c.proof.command : c.proof.step;
      const claim = field(c.claim, redact, JUDGE_CLAIM_MAX_CHARS);
      return `${c.index}. ${claim} [${c.proof.kind}: ${field(proof, redact, JUDGE_CLAIM_MAX_CHARS)}]`;
    })
    .join("\n");
}

/** The QA report of the latest QaPassed and the head it was produced for, or null. */
function qaReportOf(events: StoredEvent[]): { report: QaReport; headSha: string } | null {
  const passed = events
    .filter((e) => e.type === "StateChanged" && isQaPassed(e.payload))
    .reduce<StoredEvent | null>((a, b) => (a === null || b.seq > a.seq ? b : a), null);
  if (passed === null || passed.runId === null) return null;
  const finished = events
    .filter((e) => e.type === "RunFinished" && e.runId === passed.runId && e.seq < passed.seq)
    .reduce<StoredEvent | null>((a, b) => (a === null || b.seq > a.seq ? b : a), null);
  const output = (finished?.payload as { output?: unknown } | null | undefined)?.output;
  const parsed = qaReportSchema.safeParse(output);
  if (!parsed.success) return null;
  const work = workReportOf(events.filter((e) => e.seq < passed.seq));
  return work === null ? null : { report: parsed.data, headSha: work.headSha };
}

function isQaPassed(payload: unknown): boolean {
  return (payload as { trigger?: unknown } | null)?.trigger === "QaPassed";
}

function reportText(found: { report: QaReport; headSha: string }, redact: Redact): string {
  const { report, headSha } = found;
  const lines = [`QA report head SHA: ${headSha}`, `verdict: ${report.verdict}`, "criteria:"];
  for (const c of report.criteria) {
    lines.push(`- index: ${c.index}`, `  result: ${c.result}`);
    if (c.how !== undefined) {
      lines.push(`  how: ${field(c.how, redact, JUDGE_HOW_MAX_CHARS)}`);
    }
  }
  lines.push("notChecked:");
  for (const item of report.notChecked) {
    lines.push(`- ${field(item, redact, JUDGE_NOT_CHECKED_MAX_CHARS)}`);
  }
  return lines.join("\n");
}

/**
 * The criteria and the QA report of the reviewed head, as two untrusted-data blocks for the Judge
 * prompt (D104), or null when either is missing. Pure: redaction is injected.
 */
export function judgeContextOf(
  events: StoredEvent[],
  headSha: string,
  redact: Redact,
): string | null {
  const criteria = criteriaText(events, redact);
  if (criteria === null) return null;
  const found = qaReportOf(events);
  if (found === null || found.headSha !== headSha) return null;
  const report = reportText(found, redact);
  const overhead =
    OPEN("criteria").length + OPEN("qa_report").length + 2 * CLOSE.length + "\n\n".length;
  const budget = JUDGE_CONTEXT_MAX_CHARS - overhead;
  const criteriaBudget = Math.max(0, budget - report.length);
  const body = {
    criteria: cut(criteria, criteriaBudget),
    report: cut(report, budget),
  };
  return (
    OPEN("criteria") + body.criteria + CLOSE + "\n\n" + OPEN("qa_report") + body.report + CLOSE
  );
}
