import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAgentRuntime, type AgentRuntime, type GitHubPort } from "@friday/application";
import { createEventStore, createIssueRepository } from "@friday/infrastructure";
import { vi } from "vitest";
import { composeDaemon, type ComposeOptions, type Daemon } from "../src/index.ts";
import { fakeWorktrees, fixture, NOW } from "./compose-helpers.ts";
import { FakeClock } from "./fakes.ts";
import { agents, finished, verdict } from "./judge-dispatch-helpers.ts";
import { CountingPendingRuntime, FakeCiGitHub, FakeReviewer } from "./judge-fakes.ts";

export const A = "a".repeat(40);
export const input = () => ({ cwd: "/tmp/wt", prompt: "judge", configRoot: "/tmp/cfg" });

export type Over = {
  yaml?: (y: string) => string;
  env?: Record<string, string | undefined>;
  withJudge?: boolean;
  runtime?: AgentRuntime;
  extra?: Partial<ComposeOptions>;
};

export function setup(o: Over = {}) {
  const root = mkdtempSync(join(tmpdir(), "friday-judge-"));
  cpSync(fixture, root, { recursive: true });
  const file = join(root, "factory.yaml");
  const yaml = readFileSync(file, "utf8");
  writeFileSync(file, (o.yaml ?? ((y) => y))(yaml));
  const author = new FakeCiGitHub();
  author.issues.push({ number: 7, title: "T", body: "- risco: low — x", labels: ["friday"] });
  const reviewers: FakeReviewer[] = [];
  const logs: string[] = [];
  const runtime = o.runtime ?? new FakeAgentRuntime([finished(verdict())]);
  const optsRuntime = new CountingPendingRuntime();
  const createRuntime = vi.fn(() => runtime);
  const createGitHub = vi.fn((token: string) => {
    if (token === "t0k3n") return author as unknown as GitHubPort;
    const reviewer = new FakeReviewer(token);
    reviewers.push(reviewer);
    return reviewer as unknown as GitHubPort;
  });
  const opts: ComposeOptions = {
    root,
    dbPath: join(root, "friday.db"),
    projectId: "p",
    env: o.env ?? { FRIDAY_AUTHOR_TOKEN: "t0k3n", FRIDAY_REVIEW_TOKEN: "jud9e" },
    worktrees: fakeWorktrees(),
    runtime: optsRuntime,
    prOf: () => 30,
    clock: new FakeClock(),
    lock: { pid: 101, kill: () => undefined },
    now: () => NOW,
    log: (m) => logs.push(m),
    createGitHub: createGitHub as unknown as ComposeOptions["createGitHub"],
    createRuntime,
    ...(o.withJudge === false ? {} : { judge: { base: "main", agents: agents(), input } }),
    ...o.extra,
  };
  return { root, opts, author, reviewers, logs, runtime, optsRuntime, createRuntime };
}

export function put(daemon: Daemon, issueId: number, to: string): void {
  createEventStore(daemon.db).append({
    projectId: "p",
    issueId,
    runId: null,
    type: "StateChanged",
    actor: "daemon",
    at: NOW.toISOString(),
    payload: { to, heldReason: null, verifyRound: 0, qaRound: 0, reviewIter: 0 },
  });
  createIssueRepository(daemon.db).rebuild("p");
}

export const stateOf = (d: Daemon, id: number) => createIssueRepository(d.db).get("p", id)?.state;
export const eventsOf = (d: Daemon, type: string) =>
  createEventStore(d.db)
    .list("p", 7)
    .filter((e) => e.type === type);

export async function runJudge(o: Over = {}) {
  const t = setup(o);
  const daemon = await composeDaemon(t.opts);
  put(daemon, 7, "InReview");
  await daemon.ticker.tick();
  await daemon.ticker.idle();
  return { ...t, daemon };
}
