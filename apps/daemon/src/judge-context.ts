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
const OPENING_TAG = /<\s*untrusted_data/gi;
const OPEN = (kind: string) => `<untrusted_data kind="${kind}">\n`;
const CLOSE = "\n</untrusted_data>";

type Redact = (text: string) => string;

/** Cuts `text` to `max` characters, the last ones being the truncation marker. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= TRUNCATED.length) return TRUNCATED.slice(0, Math.max(0, max));
  return text.slice(0, max - TRUNCATED.length) + TRUNCATED;
}

const SHORT_ESCAPES: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };
const PARTIAL_ESCAPE = /\\(?:u[0-9a-f]{0,3})?$/;

/** C0, DEL, C1, U+2028 and U+2029. */
function isControl(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

/** Turns line breaks and other control characters into visible escape sequences. */
function escapeControl(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (!isControl(code)) out += ch;
    else out += SHORT_ESCAPES[ch] ?? `\\u${code.toString(16).padStart(4, "0")}`;
  }
  return out;
}

/** Caps an escaped field to `max` characters, backing off before a half escape sequence. */
function capField(text: string, max: number): string {
  if (text.length <= max) return text;
  let head = text.slice(0, max);
  const next = text[max] ?? "";
  const partial = PARTIAL_ESCAPE.exec(head);
  if (partial !== null && (partial[0].length > 1 || /[nrtu]/.test(next))) {
    head = head.slice(0, partial.index);
  }
  return head + TRUNCATED;
}

/** Redacts secrets, escapes control characters, neutralizes the delimiters and caps the field. */
function field(text: string, redact: Redact, max: number): string {
  const escaped = escapeControl(redact(text));
  const safe = escaped
    .replace(CLOSING_TAG, (m) => `<\\/${m.slice(2).trimStart()}`)
    .replace(OPENING_TAG, (m) => `<\\${m.slice(1).trimStart()}`);
  return capField(safe, max);
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
  // The criteria are guaranteed half of the body budget; what a block does not use goes to the other (D105).
  const half = Math.floor(budget / 2);
  const criteriaMax = Math.max(half, budget - report.length);
  const reportMax = budget - Math.min(criteria.length, criteriaMax);
  const body = {
    criteria: cut(criteria, criteriaMax),
    report: cut(report, reportMax),
  };
  return (
    OPEN("criteria") + body.criteria + CLOSE + "\n\n" + OPEN("qa_report") + body.report + CLOSE
  );
}
