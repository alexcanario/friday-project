import { Octokit } from "octokit";

export type RecordedCall = {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
};

export type FakeIssue = {
  number: number;
  title?: string;
  body?: string | null;
  labels?: string[];
  pullRequest?: boolean;
};
export type FakePull = { number: number; head: string; headRef: string; base: string; sha: string };
export type FakeCheckRun = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
};
export type FakeFile = {
  filename: string;
  previous_filename?: string;
  additions: number;
  deletions: number;
  patch?: string;
};

export type FakeGitHub = {
  fetch: typeof globalThis.fetch;
  calls: RecordedCall[];
  issues: FakeIssue[];
  comments: Map<number, string[]>;
  pulls: FakePull[];
  checkRuns: Map<string, FakeCheckRun[]>;
  files: Map<number, FakeFile[]>;
  mergeStatus: number;
  mergeSha: string;
  pageSize: number;
};

const BASE = /^\/repos\/o\/r/;

export function createTestOctokit(fetch: typeof globalThis.fetch): Octokit {
  return new Octokit({
    auth: "test-token",
    request: { fetch },
    retry: { enabled: false },
    throttle: { enabled: false },
  });
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function page<T>(items: T[], url: URL, size: number): Response {
  const n = Number(url.searchParams.get("page") ?? "1");
  const slice = items.slice((n - 1) * size, n * size);
  const headers: Record<string, string> = {};
  if (n * size < items.length) {
    const next = new URL(url);
    next.searchParams.set("page", String(n + 1));
    headers.link = `<${next.toString()}>; rel="next"`;
  }
  return json(slice, 200, headers);
}

function pullJson(p: FakePull): unknown {
  return {
    number: p.number,
    head: { sha: p.sha, ref: p.headRef },
    base: { ref: p.base },
  };
}

export function createGitHubFake(): FakeGitHub {
  const fake: FakeGitHub = {
    fetch: (async () => json({})) as typeof globalThis.fetch,
    calls: [],
    issues: [],
    comments: new Map(),
    pulls: [],
    checkRuns: new Map(),
    files: new Map(),
    mergeStatus: 200,
    mergeSha: "m1",
    pageSize: 100,
  };
  fake.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = decodeURIComponent(url.pathname);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    fake.calls.push({ method, path, query: Object.fromEntries(url.searchParams), body });
    const res = route(fake, method, path, url, body);
    Object.defineProperty(res, "url", { value: url.toString() });
    return res;
  }) as typeof globalThis.fetch;
  return fake;
}

function labelsOf(fake: FakeGitHub, n: number): FakeIssue | undefined {
  return fake.issues.find((i) => i.number === n);
}

function route(
  fake: FakeGitHub,
  method: string,
  path: string,
  url: URL,
  body: { labels: string[]; body: string; head: string; base: string },
): Response {
  if (!BASE.test(path)) return json({ message: "Not Found" }, 404);
  const rest = path.replace(BASE, "");
  let m: RegExpMatchArray | null;
  if (method === "GET" && rest === "/issues") {
    const label = url.searchParams.get("labels");
    const items = fake.issues
      .filter((i) => label === null || (i.labels ?? []).includes(label))
      .map((i) => ({
        number: i.number,
        title: i.title ?? `issue ${i.number}`,
        body: i.body === undefined ? "" : i.body,
        labels: (i.labels ?? []).map((name) => ({ name })),
        ...(i.pullRequest ? { pull_request: {} } : {}),
      }));
    return page(items, url, fake.pageSize);
  }
  if ((m = rest.match(/^\/issues\/(\d+)\/labels(?:\/(.+))?$/))) {
    const issue = labelsOf(fake, Number(m[1]));
    if (!issue) return json({ message: "Not Found" }, 404);
    issue.labels ??= [];
    if (method === "GET" && !m[2])
      return page(
        issue.labels.map((name) => ({ name })),
        url,
        fake.pageSize,
      );
    if (method === "POST" && !m[2]) {
      issue.labels.push(...body.labels);
      return json(issue.labels.map((name) => ({ name })));
    }
    if (method === "DELETE" && m[2]) {
      issue.labels = issue.labels.filter((l) => l !== m![2]);
      return json(issue.labels.map((name) => ({ name })));
    }
  }
  if ((m = rest.match(/^\/issues\/(\d+)\/comments$/))) {
    const list = fake.comments.get(Number(m[1])) ?? [];
    if (method === "GET")
      return page(
        list.map((b, id) => ({ id, body: b })),
        url,
        fake.pageSize,
      );
    if (method === "POST") {
      fake.comments.set(Number(m[1]), [...list, body.body]);
      return json({ id: list.length, body: body.body }, 201);
    }
  }
  if (method === "GET" && rest === "/pulls") {
    const head = url.searchParams.get("head");
    const base = url.searchParams.get("base");
    const items = fake.pulls.filter((p) => p.head === head && p.base === base).map(pullJson);
    return page(items, url, fake.pageSize);
  }
  if (method === "POST" && rest === "/pulls") {
    const pr: FakePull = {
      number: 30,
      head: `o:${body.head}`,
      headRef: body.head,
      base: body.base,
      sha: "aaa",
    };
    fake.pulls.push(pr);
    return json(pullJson(pr), 201);
  }
  if ((m = rest.match(/^\/pulls\/(\d+)$/)) && method === "GET") {
    const pr = fake.pulls.find((p) => p.number === Number(m![1]));
    return pr ? json(pullJson(pr)) : json({ message: "Not Found" }, 404);
  }
  if ((m = rest.match(/^\/pulls\/(\d+)\/files$/)) && method === "GET") {
    return page(fake.files.get(Number(m[1])) ?? [], url, fake.pageSize);
  }
  if ((m = rest.match(/^\/pulls\/(\d+)\/merge$/)) && method === "PUT") {
    if (fake.mergeStatus !== 200) return json({ message: "merge failed" }, fake.mergeStatus);
    return json({ merged: true, sha: fake.mergeSha, message: "ok" });
  }
  if ((m = rest.match(/^\/commits\/([^/]+)\/check-runs$/)) && method === "GET") {
    const runs = fake.checkRuns.get(m[1] ?? "") ?? [];
    const n = Number(url.searchParams.get("page") ?? "1");
    const slice = runs.slice((n - 1) * fake.pageSize, n * fake.pageSize);
    const headers: Record<string, string> = {};
    if (n * fake.pageSize < runs.length) {
      const next = new URL(url);
      next.searchParams.set("page", String(n + 1));
      headers.link = `<${next.toString()}>; rel="next"`;
    }
    return json({ total_count: runs.length, check_runs: slice }, 200, headers);
  }
  return json({ message: "Not Found" }, 404);
}
