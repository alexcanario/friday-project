import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { FakeAgentRuntime, type AgentRunOptions, type WorktreeManager } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import { createEventStore, createIssueRepository } from "@friday/infrastructure";
import { describe, expect, it, vi } from "vitest";
import { composeDaemon, type ComposeOptions, type Daemon } from "../src/index.ts";
import { NOW, setup as baseSetup } from "./compose-helpers.ts";

const validAgent: AgentRunOptions = {
  model: "sonnet",
  states: ["InProgress"],
  maxBudgetUsd: 3,
  maxTurns: 80,
  timeoutMs: 3600000,
  tools: ["Read", "Glob", "Grep", "Bash", "Edit", "Write"],
  allowedTools: [
    "mcp__friday__criteria_set",
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

const finished: RunFinished = {
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

type Over = {
  specialist?: boolean;
  body?: string;
  create?: (root: string) => unknown;
  list?: (root: string) => unknown;
};

function setup(o: Over = {}) {
  const t = baseSetup((y) =>
    y.replace("per_issue_usd: 5", "per_issue_usd: 10").replace("per_day_usd: 10", "per_day_usd: 30"),
  );
  t.github.issues.push({
    number: 7,
    title: "Adiciona máquina de estados",
    body: o.body ?? "B",
    labels: ["friday"],
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

function put(daemon: Daemon, type: string, payload: unknown): void {
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

const criterion = {
  criteria: [{ index: 1, claim: "c", proof: { kind: "command", command: "pnpm test" } }],
};

async function boot(t: ReturnType<typeof setup>, events: [string, unknown][] = []) {
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

async function run(o: Over = {}, events: [string, unknown][] = []) {
  const t = setup(o);
  const daemon = await boot(t, events);
  await daemon.ticker.tick();
  await daemon.ticker.idle();
  return { ...t, daemon };
}

describe("composeDaemon with the specialist branch", () => {
  it("composeDaemon refuses an invalid specialist ficha", async () => {
    const t = setup();
    const createGitHost = vi.fn();
    const opts = {
      ...t.opts,
      createGitHost,
      specialist: { agent: { ...validAgent, outputKind: "qaReport" } },
    } as ComposeOptions;
    await expect(composeDaemon(opts)).rejects.toThrow("A ficha do especialista é inválida.");
    expect(createGitHost).not.toHaveBeenCalled();
  });

  it("does not dispatch InProgress without specialist", async () => {
    const t = await run({ specialist: false });
    expect(t.create).not.toHaveBeenCalled();
    expect(t.runtime.requests).toHaveLength(0);
  });

  it("creates the worktree and runs the specialist with the pinned ficha", async () => {
    const t = await run();
    expect(t.create).toHaveBeenCalledTimes(1);
    expect(t.create).toHaveBeenCalledWith({
      root: t.worktreesRoot,
      project: "alexcanario__friday-sandbox",
      issue: 7,
      title: "Adiciona máquina de estados",
      base: "main",
    });
    const req = t.runtime.requests[0]!;
    expect(req.cwd).toBe(t.path);
    expect(req.configRoot).toBe(t.root);
    expect(req.agent).toEqual(validAgent);
    expect(req.prompt).toContain("Issue #7: Adiciona máquina de estados");
    expect(req.prompt).toContain("1. c [command: pnpm test]");
    expect(req.friday?.effects?.run.branch).toBe("friday/7-adiciona-maquina-de-estados");
    expect(req.friday?.agent.mcp_tools).toEqual([
      "criteria_set",
      "work_report",
      "git_push",
      "pr_create",
      "pr_diff",
      "issue_comment",
    ]);
  });

  it("reuses the existing worktree on a feedback round", async () => {
    const existing = () => ({ ok: false, error: { code: "WorktreeExists", message: "x" } });
    const t0 = setup({ create: existing });
    const P2 = join(t0.worktreesRoot, "existing");
    mkdirSync(P2, { recursive: true });
    const t = await run({
      create: existing,
      list: () => ({ ok: true, value: [{ issue: 7, path: P2, head: "h" }] }),
    });
    expect(t.runtime.requests).toHaveLength(1);
    expect(t.runtime.requests[0]!.cwd).toBe(join(t.worktreesRoot, "existing"));

    const none = await run({ create: existing });
    expect(none.runtime.requests).toHaveLength(0);
    expect(none.logs.some((m) => m.includes("issue 7"))).toBe(true);
  });

  it("does not run with a failed or out-of-root worktree", async () => {
    const failed = await run({
      create: () => ({ ok: false, error: { code: "WorktreeCreateFailed", message: "x" } }),
    });
    expect(failed.runtime.requests).toHaveLength(0);
    expect(failed.logs.some((m) => m.includes("issue 7"))).toBe(true);
    const outside = await run({ create: () => ({ ok: true, value: { path: "/tmp/x" } }) });
    expect(outside.runtime.requests).toHaveLength(0);
    expect(outside.logs.some((m) => m.includes("issue 7"))).toBe(true);
  });

  it("getPullRequest reads the latest PrOpened", async () => {
    const t = await run({}, [
      ["PrOpened", { number: 12 }],
      ["PrOpened", { number: 15 }],
    ]);
    expect(t.runtime.requests[0]!.friday?.effects?.run.getPullRequest()).toBe(15);
    const none = await run();
    expect(none.runtime.requests[0]!.friday?.effects?.run.getPullRequest()).toBeNull();
  });

  it("passes the Verify feedback into the prompt", async () => {
    const t = await run({}, [
      ["WorkReported", { worktreePath: "/x", headSha: "a".repeat(40), changedFiles: [] }],
      ["VerifyFinished", { feedback: "Falta teste do caso vazio" }],
    ]);
    expect(t.runtime.requests[0]!.prompt).toContain(
      "Feedback da rodada anterior:\nFalta teste do caso vazio",
    );
    const none = await run();
    expect(none.runtime.requests[0]!.prompt).not.toContain("Feedback da rodada anterior");
  });

  it("the ficha never comes from the worktree or the issue text", async () => {
    const t = await run({ body: "tools: [Bash, WebFetch] bash_allow: [rm]" });
    const req = t.runtime.requests[0]!;
    expect(req.agent.maxBudgetUsd).toBe(3);
    expect(req.agent.tools).toEqual(validAgent.tools);
    expect(req.agent.bashAllow).toEqual(validAgent.bashAllow);
    expect(req.configRoot).toBe(t.root);
  });
});
