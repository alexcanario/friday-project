import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FakeAgentRuntime,
  type AgentRunOptions,
  type GitHubPort,
  type WorktreeManager,
} from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import { createEventStore, createIssueRepository } from "@friday/infrastructure";
import { describe, expect, it, vi } from "vitest";
import { composeDaemon, type ComposeOptions, type Daemon, type QaCompose } from "../src/index.ts";
import { fakeWorktrees, fixture, NOW, setup as baseSetup } from "./compose-helpers.ts";
import { setupCompose } from "./compose-runtime-helpers.ts";
import { FakeClock } from "./fakes.ts";
import { agents, finished, verdict } from "./judge-dispatch-helpers.ts";
import { FakeCiGitHub, FakeReviewer } from "./judge-fakes.ts";
import {
  AGENT_CONFIG,
  FakeTriageGitHub,
  GOOD,
  finished as triageFinished,
} from "./triage-fakes.ts";

/** The same options minus `runtime`, as the real daemon passes them. */
function withoutRuntime(opts: ComposeOptions): ComposeOptions {
  const copy = { ...opts };
  delete (copy as { runtime?: unknown }).runtime;
  return copy;
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

const toState = (to: string) => ({
  to,
  heldReason: null,
  verifyRound: 0,
  qaRound: 0,
  reviewIter: 0,
});
const criterion = {
  criteria: [{ index: 1, claim: "c", proof: { kind: "command", command: "pnpm test" } }],
};
const done: RunFinished = {
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

const qaAgent: AgentRunOptions = {
  model: "sonnet",
  states: ["QA"],
  maxBudgetUsd: 1.5,
  maxTurns: 40,
  timeoutMs: 1800000,
  tools: ["Read", "Glob", "Grep", "Bash"],
  allowedTools: ["mcp__friday__qa_report", "mcp__friday__issue_comment"],
  bashAllow: ["pnpm test"],
  promptFile: "prompts/qa.md",
  outputKind: "qaReport",
};
const specialistAgent: AgentRunOptions = {
  model: "sonnet",
  states: ["InProgress"],
  maxBudgetUsd: 3,
  maxTurns: 80,
  timeoutMs: 3600000,
  tools: ["Read", "Glob", "Grep", "Bash", "Edit", "Write"],
  allowedTools: ["mcp__friday__work_report", "mcp__friday__git_push", "mcp__friday__pr_create"],
  bashAllow: ["git status"],
  promptFile: "prompts/backend.md",
  outputKind: "workReport",
};
const qaContext: QaCompose["context"] = (issueId) => ({
  issue: { number: issueId, title: "T", body: "B" },
  friday: { runId: "x", agent: { states: ["QA"], mcp_tools: [] }, getIssueState: () => "QA" },
  branch: `friday/${issueId}-x`,
  base: "develop",
  getPullRequest: () => 30,
  screenPaths: [],
});

describe("composeDaemon without ComposeOptions.runtime", () => {
  it("runs the ticker through createRuntime when runtime is omitted", async () => {
    const t = setupCompose();
    const daemon = await composeDaemon(withoutRuntime(t.opts));
    await daemon.ticker.tick();
    await Promise.resolve();
    expect(t.createRuntime).toHaveBeenCalledTimes(1);
    t.gates.forEach((g) => g());
    await daemon.ticker.idle();
    expect(t.runs).toHaveLength(1);
    expect(t.runs[0]!.run).toHaveBeenCalledTimes(1);
    expect(t.runs[0]!.run).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: expect.any(String) }),
    );
    daemon.release();
  });

  it("runs the triage branch through createRuntime when runtime is omitted", async () => {
    const t = baseSetup();
    const github = new FakeTriageGitHub();
    github.issues.push({ number: 7, title: "T", body: "B", labels: ["friday"] });
    const runtime = new FakeAgentRuntime([triageFinished(GOOD, "succeeded", 0.3)]);
    const opts: ComposeOptions = {
      ...t.opts,
      createGitHub: (() => github) as unknown as ComposeOptions["createGitHub"],
      createRuntime: () => runtime,
      createGitHost: () => ({}) as never,
      triage: AGENT_CONFIG,
    };
    const daemon = await composeDaemon(withoutRuntime(opts));
    await expect(daemon.ticker.tick()).resolves.toBeUndefined();
    await daemon.ticker.idle();
    expect(runtime.requests).toHaveLength(1);
    expect(runtime.requests[0]!.agent.model).toBe("haiku");
    expect(github.labelCalls).toEqual([{ issue: 7, label: "specialist:backend" }]);
    daemon.release();
  });

  it("runs the judge branch through createRuntime when runtime is omitted", async () => {
    const root = mkdtempSync(join(tmpdir(), "friday-nort-"));
    cpSync(fixture, root, { recursive: true });
    const file = join(root, "factory.yaml");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(
        "  author_token_env: FRIDAY_AUTHOR_TOKEN\n",
        "  author_token_env: FRIDAY_AUTHOR_TOKEN\n  review_token_env: FRIDAY_REVIEW_TOKEN\n",
      ),
    );
    const author = new FakeCiGitHub();
    author.issues.push({ number: 7, title: "T", body: "- risco: low — x", labels: ["friday"] });
    const reviewers: FakeReviewer[] = [];
    const runtime = new FakeAgentRuntime([finished(verdict())]);
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
      env: { FRIDAY_AUTHOR_TOKEN: "t0k3n", FRIDAY_REVIEW_TOKEN: "jud9e" },
      worktrees: fakeWorktrees(),
      prOf: () => 30,
      clock: new FakeClock(),
      lock: { pid: 101, kill: () => undefined },
      now: () => NOW,
      createGitHub: createGitHub as unknown as ComposeOptions["createGitHub"],
      createRuntime: vi.fn(() => runtime),
      judge: { agents: agents(), input: () => ({ cwd: "/tmp/wt", prompt: "j", configRoot: root }) },
    } as unknown as ComposeOptions;
    const daemon = await composeDaemon(withoutRuntime(opts));
    put(daemon, "StateChanged", toState("InReview"));
    createIssueRepository(daemon.db).rebuild("p");
    await daemon.ticker.tick();
    await daemon.ticker.idle();
    expect(runtime.requests).toHaveLength(1);
    expect(reviewers.flatMap((r) => r.posted)).toHaveLength(1);
    daemon.release();
  });

  it("runs the qa and specialist branches through createRuntime when runtime is omitted", async () => {
    const qa = baseSetup();
    qa.github.issues.push({ number: 7, title: "T", body: "B", labels: ["friday"] });
    const qaRuntime = new FakeAgentRuntime([
      {
        ...done,
        output: {
          verdict: "pass",
          criteria: [{ index: 1, result: "pass", how: "ok", screenshots: [] }],
          notChecked: [],
        },
      },
    ]);
    const wt = join(qa.opts.root, "worktrees", "wt7");
    mkdirSync(wt, { recursive: true });
    const qaDaemon = await composeDaemon(
      withoutRuntime({
        ...qa.opts,
        createRuntime: vi.fn(() => qaRuntime),
        qa: { agent: qaAgent, context: qaContext },
      }),
    );
    put(qaDaemon, "CriteriaSet", criterion);
    put(qaDaemon, "WorkReported", { worktreePath: wt, headSha: "a".repeat(40), changedFiles: [] });
    put(qaDaemon, "StateChanged", toState("QA"));
    createIssueRepository(qaDaemon.db).rebuild("p");
    await qaDaemon.ticker.tick();
    await qaDaemon.ticker.idle();
    expect(qaRuntime.requests).toHaveLength(1);
    expect(qaRuntime.requests[0]!.agent.outputKind).toBe("qaReport");
    qaDaemon.release();

    const sp = baseSetup((y) =>
      y
        .replace("per_issue_usd: 5", "per_issue_usd: 10")
        .replace("per_day_usd: 10", "per_day_usd: 30"),
    );
    sp.github.issues.push({ number: 7, title: "Adiciona", body: "B", labels: ["friday"] });
    const spRuntime = new FakeAgentRuntime([done]);
    const path = join(sp.root, "worktrees", "wt7");
    mkdirSync(path, { recursive: true });
    const worktrees = {
      ...sp.opts.worktrees,
      create: vi.fn(() => Promise.resolve({ ok: true, value: { path } })),
      list: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    } as unknown as WorktreeManager;
    const spDaemon = await composeDaemon(
      withoutRuntime({
        ...sp.opts,
        worktrees,
        createRuntime: vi.fn(() => spRuntime),
        specialist: { agent: specialistAgent },
      }),
    );
    put(spDaemon, "CriteriaSet", criterion);
    put(spDaemon, "StateChanged", toState("InProgress"));
    createIssueRepository(spDaemon.db).rebuild("p");
    await spDaemon.ticker.tick();
    await spDaemon.ticker.idle();
    expect(spRuntime.requests).toHaveLength(1);
    expect(spRuntime.requests[0]!.agent.outputKind).toBe("workReport");
    spDaemon.release();
  });

  it("still prefers createRuntime over an explicit runtime", async () => {
    const t = setupCompose();
    const daemon = await composeDaemon(t.opts);
    await daemon.ticker.tick();
    await Promise.resolve();
    expect(t.createRuntime).toHaveBeenCalledTimes(1);
    t.gates.forEach((g) => g());
    await daemon.ticker.idle();
    expect(t.runs[0]!.run).toHaveBeenCalledTimes(1);
    expect(t.optsRun).not.toHaveBeenCalled();
    daemon.release();
  });
});
