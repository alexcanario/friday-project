import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { FakeAgentRuntime, type AgentRunOptions } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import { createEventStore, createIssueRepository } from "@friday/infrastructure";
import { vi } from "vitest";
import { composeDaemon, type ComposeOptions, type Daemon, type QaCompose } from "../src/index.ts";
import { NOW, setup as baseSetup } from "./compose-helpers.ts";

export const SHA = "a".repeat(40);
export const finished = (output: unknown, costUsd: number | null = null): RunFinished => ({
  status: "succeeded",
  subtype: null,
  model: null,
  costUsd,
  tokens: null,
  numTurns: null,
  durationMs: null,
  output,
  violations: [],
});
export const pass = {
  verdict: "pass",
  criteria: [{ index: 1, result: "pass", how: "ok", screenshots: [] }],
  notChecked: [],
};
export const validAgent: AgentRunOptions = {
  model: "sonnet",
  states: ["QA"],
  maxBudgetUsd: 1.5,
  maxTurns: 40,
  timeoutMs: 1800000,
  tools: ["Read", "Glob", "Grep", "Bash"],
  allowedTools: ["mcp__friday__qa_report", "mcp__friday__issue_comment"],
  bashAllow: ["pnpm test", "git diff origin/develop...HEAD"],
  promptFile: "prompts/qa.md",
  outputKind: "qaReport",
};

export type Over = {
  qa?: boolean;
  agent?: AgentRunOptions;
  context?: QaCompose["context"];
  worktreeOf?: (root: string) => string;
  criteria?: boolean;
  report?: boolean;
  results?: RunFinished[];
};

export const contextFor: QaCompose["context"] = (issueId) => ({
  issue: { number: issueId, title: "T", body: "B" },
  friday: {
    runId: "x",
    agent: { states: ["QA"], mcp_tools: [] },
    getIssueState: () => "QA",
  },
  branch: `friday/${issueId}-x`,
  base: "develop",
  getPullRequest: () => 30,
  screenPaths: [],
});

export function setup(o: Over = {}) {
  const t = baseSetup();
  t.github.issues.push({ number: 7, title: "T", body: "B", labels: ["friday"] });
  const runtime = new FakeAgentRuntime(o.results ?? [finished(pass)]);
  const worktree = o.worktreeOf?.(t.opts.root) ?? join(t.opts.root, "worktrees", "wt7");
  mkdirSync(join(t.opts.root, "worktrees", "wt7"), { recursive: true });
  const opts: ComposeOptions = {
    ...t.opts,
    createRuntime: vi.fn(() => runtime),
    ...(o.qa === false
      ? {}
      : { qa: { agent: o.agent ?? validAgent, context: o.context ?? contextFor } }),
  };
  return { ...t, opts, runtime, worktree, o };
}

export function put(daemon: Daemon, type: string, payload: unknown): void {
  createEventStore(daemon.db).append({
    projectId: "p",
    issueId: 7,
    runId: null,
    type,
    actor: "daemon",
    at: NOW.toISOString(),
    payload,
  });
}

export async function boot(t: ReturnType<typeof setup>) {
  const daemon = await composeDaemon(t.opts);
  if (t.o.criteria !== false) {
    put(daemon, "CriteriaSet", {
      criteria: [{ index: 1, claim: "c", proof: { kind: "command", command: "pnpm test" } }],
    });
  }
  if (t.o.report !== false) {
    put(daemon, "WorkReported", { worktreePath: t.worktree, headSha: SHA, changedFiles: [] });
  }
  put(daemon, "StateChanged", {
    to: "QA",
    heldReason: null,
    verifyRound: 0,
    qaRound: 0,
    reviewIter: 0,
  });
  createIssueRepository(daemon.db).rebuild("p");
  return daemon;
}

export async function runQa(o: Over = {}) {
  const t = setup(o);
  const daemon = await boot(t);
  await daemon.ticker.tick();
  await daemon.ticker.idle();
  return { ...t, daemon };
}

export const stateOf = (d: Daemon) => createIssueRepository(d.db).get("p", 7)?.state;
export const eventsOf = (d: Daemon, type: string) =>
  createEventStore(d.db)
    .list("p", 7)
    .filter((e) => e.type === type);
export const ledgerRows = (d: Daemon) =>
  d.db.sqlite.prepare("SELECT run_id, cost_usd, cost_unknown FROM ledger").all() as {
    run_id: string;
    cost_usd: number | null;
    cost_unknown: number;
  }[];
