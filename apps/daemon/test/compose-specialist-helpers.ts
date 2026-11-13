import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { FakeAgentRuntime, type AgentRunOptions, type WorktreeManager } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import { createEventStore, createIssueRepository } from "@friday/infrastructure";
import { vi } from "vitest";
import { composeDaemon, type ComposeOptions, type Daemon } from "../src/index.ts";
import { NOW, setup as baseSetup } from "./compose-helpers.ts";

export const validAgent: AgentRunOptions = {
  model: "sonnet",
  states: ["InProgress"],
  maxBudgetUsd: 3,
  maxTurns: 80,
  timeoutMs: 3600000,
  tools: ["Read", "Glob", "Grep", "Bash", "Edit", "Write"],
  allowedTools: [
    "mcp__friday__work_report",
    "mcp__friday__git_push",
    "mcp__friday__pr_create",
    "mcp__friday__pr_diff",
    "mcp__friday__issue_comment",
  ],
  bashAllow: ["dotnet restore", "dotnet build", "dotnet test", "git status", "git diff"],
  promptFile: "prompts/backend.md",
  outputKind: "workReport",
};

export const finished: RunFinished = {
  status: "succeeded",
  subtype: null,
  model: null,
  costUsd: null,
  tokens: null,
  numTurns: null,
  durationMs: null,
  output: null,
  violations: [],
};

export type Over = {
  specialist?: boolean;
  body?: string;
  create?: (root: string) => unknown;
  list?: (root: string) => unknown;
};

export function setup(o: Over = {}) {
  const t = baseSetup((y) =>
    y
      .replace("per_issue_usd: 5", "per_issue_usd: 10")
      .replace("per_day_usd: 10", "per_day_usd: 30"),
  );
  t.github.issues.push({
    number: 7,
    title: "Adiciona máquina de estados",
    body: o.body ?? "B",
    labels: ["friday"],
  });
  // A issue com PR só roda com a worktree no head do PR (D107): o PR e a worktree dos testes estão em "h".
  Object.assign(t.github, {
    getPrMergeState: () => Promise.resolve({ merged: false, headSha: "h" }),
  });
  const runtime = new FakeAgentRuntime([finished]);
  const worktreesRoot = join(t.root, "worktrees");
  const path = join(worktreesRoot, "wt7");
  mkdirSync(path, { recursive: true });
  const create = vi.fn(() => Promise.resolve(o.create?.(t.root) ?? { ok: true, value: { path } }));
  const list = vi.fn(() => Promise.resolve(o.list?.(t.root) ?? { ok: true, value: [] }));
  const worktrees = { ...t.opts.worktrees, create, list } as unknown as WorktreeManager;
  const opts: ComposeOptions = {
    ...t.opts,
    worktrees,
    createRuntime: vi.fn(() => runtime),
    ...(o.specialist === false ? {} : { specialist: { agent: validAgent } }),
  };
  return { ...t, opts, runtime, create, list, path, worktreesRoot };
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

export const criterion = {
  criteria: [{ index: 1, claim: "c", proof: { kind: "command", command: "pnpm test" } }],
};

export async function boot(t: ReturnType<typeof setup>, events: [string, unknown][] = []) {
  const daemon = await composeDaemon(t.opts);
  put(daemon, "CriteriaSet", criterion);
  for (const [type, payload] of events) put(daemon, type, payload);
  put(daemon, "StateChanged", {
    to: "InProgress",
    heldReason: null,
    verifyRound: 0,
    qaRound: 0,
    reviewIter: 0,
  });
  createIssueRepository(daemon.db).rebuild("p");
  return daemon;
}

export async function run(o: Over = {}, events: [string, unknown][] = []) {
  const t = setup(o);
  const daemon = await boot(t, events);
  await daemon.ticker.tick();
  await daemon.ticker.idle();
  return { ...t, daemon };
}
