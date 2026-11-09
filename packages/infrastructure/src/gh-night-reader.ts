import { execFile } from "node:child_process";
import type { NightComment, NightIssue, NightPull, NightReader } from "@friday/application";

export type GhExec = (args: string[]) => Promise<string>;

export const GH_MAX_BUFFER = 64 * 1024 * 1024;

const REPO = "repos/alexcanario/friday-project";

const defaultExec: GhExec = (args) =>
  new Promise((resolve, reject) =>
    execFile("gh", args, { encoding: "utf8", maxBuffer: GH_MAX_BUFFER }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    ),
  );

interface RawItem {
  number: number;
  title: string;
  body: string | null;
  created_at: string;
  merged_at: string | null;
  base: { ref: string };
  labels: { name: string }[];
  pull_request?: unknown;
}

// Tolerates several JSON arrays printed back to back; a single page is one array.
function parsePages(out: string): RawItem[] {
  const items: RawItem[] = [];
  let depth = 0;
  let start = 0;
  let inString = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) items.push(...(JSON.parse(out.slice(start, i + 1)) as RawItem[]));
    }
  }
  return items;
}

const toPull = (r: RawItem): NightPull => ({
  number: r.number,
  title: r.title,
  body: r.body ?? "",
  mergedAt: r.merged_at,
  baseRef: r.base.ref,
});

export function createGhNightReader(deps: { exec?: GhExec } = {}): NightReader {
  const exec = deps.exec ?? defaultExec;
  const get = async (args: string[]): Promise<RawItem[]> => parsePages(await exec(args));
  // Manual paging: `gh --paginate` breaks behind the cloud proxy past 100 items.
  // Stops at the first page with fewer than 100 raw items (before any filtering).
  const getAllPages = async (path: string): Promise<RawItem[]> => {
    const raw: RawItem[] = [];
    for (let page = 1; ; page++) {
      const items = await get(["api", `${path}&page=${page}`]);
      raw.push(...items);
      if (items.length < 100) return raw;
    }
  };
  return {
    async listComments(issue): Promise<NightComment[]> {
      const raw: RawItem[] = [];
      for (let page = 1; ; page++) {
        const items = await get([
          "api",
          `${REPO}/issues/${issue}/comments?per_page=100&page=${page}`,
        ]);
        raw.push(...items);
        if (items.length < 100) break;
      }
      return raw.map((r) => ({ body: r.body ?? "", createdAt: r.created_at }));
    },
    async listOpenIssues(label): Promise<NightIssue[]> {
      const raw = await getAllPages(`${REPO}/issues?state=open&per_page=100&labels=${label}`);
      return raw
        .filter((r) => r.pull_request === undefined)
        .map((r) => ({ number: r.number, title: r.title, labels: r.labels.map((l) => l.name) }));
    },
    async listClosedPulls() {
      const path = `${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=100`;
      return (await get(["api", path])).map(toPull);
    },
    async listOpenPulls() {
      return (await getAllPages(`${REPO}/pulls?state=open&per_page=100`)).map(toPull);
    },
  };
}
