import type { NightDigest } from "@friday/contracts";

export interface NightComment {
  body: string;
  createdAt: string;
}
export interface NightPull {
  number: number;
  title: string;
  body: string;
  mergedAt: string | null;
  baseRef: string;
}
export interface NightIssue {
  number: number;
  title: string;
  labels: string[];
}
export interface NightReader {
  listComments(issue: number): Promise<NightComment[]>;
  listOpenIssues(label: string): Promise<NightIssue[]>;
  listClosedPulls(): Promise<NightPull[]>;
  listOpenPulls(): Promise<NightPull[]>;
}

const NO_REASON = "sem motivo registrado";

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

function closesIssue(body: string): number | null {
  const m = /Closes #(\d+)/.exec(body);
  return m === null ? null : Number(m[1]);
}

function findSince(comments: NightComment[]): string | null {
  const headers = comments.filter((c) => firstLine(c.body).startsWith("## Noite de"));
  return headers.length === 0 ? null : (headers[headers.length - 1]?.createdAt ?? null);
}

function hasPhase(comments: NightComment[], since: string | null, phase: RegExp): boolean {
  return comments.some(
    (c) => (since === null || c.createdAt > since) && phase.test(firstLine(c.body)),
  );
}

function reasonOf(comments: NightComment[]): string {
  const visible = comments.filter((c) => !c.body.startsWith("<!-- friday:result"));
  const last = visible[visible.length - 1];
  return last === undefined ? NO_REASON : firstLine(last.body);
}

async function stuckPrs(reader: NightReader): Promise<NightDigest["stuckPrs"]> {
  const [pulls, blocked] = await Promise.all([
    reader.listOpenPulls(),
    reader.listOpenIssues("status:needs-human"),
  ]);
  const out: NightDigest["stuckPrs"] = [];
  for (const pr of pulls) {
    const n = closesIssue(pr.body);
    const issue = blocked.find((i) => i.number === n);
    if (n === null || issue === undefined) continue;
    const comments = await reader.listComments(n);
    const gates = issue.labels.filter((l) => l.startsWith("gate:"));
    out.push({ pr: pr.number, issue: n, gates, reason: reasonOf(comments) });
  }
  return out;
}

const brief = (i: NightIssue) => ({ number: i.number, title: i.title });

export async function buildNightDigest(
  reader: NightReader,
  reportIssue: number,
): Promise<NightDigest> {
  const comments = await reader.listComments(reportIssue);
  const since = findSince(comments);
  const [closed, stop, ready, review, stuck] = await Promise.all([
    reader.listClosedPulls(),
    reader.listOpenIssues("night:stop"),
    reader.listOpenIssues("status:ready"),
    reader.listOpenIssues("status:review"),
    stuckPrs(reader),
  ]);
  const merges = closed
    .filter((p) => p.mergedAt !== null && p.baseRef === "develop")
    .filter((p) => since === null || (p.mergedAt ?? "") > since)
    .map((p) => ({ issue: closesIssue(p.body), pr: p.number, title: p.title }));
  return {
    reportIssue,
    since,
    merges,
    stuckPrs: stuck,
    nightStop: stop.length > 0,
    ready: ready.map(brief),
    review: review.map(brief),
    phases: {
      A: hasPhase(comments, since, /^(?:\*\*)?Fase A\b/),
      B: hasPhase(comments, since, /^(?:\*\*)?Fase B\b/),
    },
  };
}
