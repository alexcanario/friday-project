import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAgentRuntime, toAgentRunOptions, type AgentRunOptions } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import {
  createEventStore,
  createIssueRepository,
  createLedgerRepository,
  createRunRepository,
} from "@friday/infrastructure";
import { describe, expect, it, vi } from "vitest";
import {
  composeDaemon,
  type ComposeOptions,
  type Daemon,
  type QaCompose,
  type QaReadPort,
} from "../src/index.ts";
import { NOW, setup as baseSetup } from "./compose-helpers.ts";

const SHA = "a".repeat(40);
const finished = (output: unknown, costUsd: number | null = null): RunFinished => ({
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
const pass = {
  verdict: "pass",
  criteria: [{ index: 1, result: "pass", how: "ok", screenshots: [] }],
  notChecked: [],
};
const validAgent: AgentRunOptions = {
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

type Over = {
  qa?: boolean;
  agent?: AgentRunOptions;
  context?: QaCompose["context"];
  worktreeOf?: (root: string) => string;
  criteria?: boolean;
  report?: boolean;
  results?: RunFinished[];
};

const contextFor: QaCompose["context"] = (issueId) => ({
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

function setup(o: Over = {}) {
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

async function boot(t: ReturnType<typeof setup>) {
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

async function runQa(o: Over = {}) {
  const t = setup(o);
  const daemon = await boot(t);
  await daemon.ticker.tick();
  await daemon.ticker.idle();
  return { ...t, daemon };
}

const stateOf = (d: Daemon) => createIssueRepository(d.db).get("p", 7)?.state;
const eventsOf = (d: Daemon, type: string) =>
  createEventStore(d.db)
    .list("p", 7)
    .filter((e) => e.type === type);
const ledgerRows = (d: Daemon) =>
  d.db.sqlite.prepare("SELECT run_id, cost_usd, cost_unknown FROM ledger").all() as {
    run_id: string;
    cost_usd: number | null;
    cost_unknown: number;
  }[];

describe("composeDaemon with the QA branch", () => {
  it("runs QA on tick for an issue in QA and moves it to InReview", async () => {
    const t = await runQa();
    expect(t.runtime.requests).toHaveLength(1);
    expect(t.runtime.requests[0]!.cwd).toBe(t.worktree);
    expect(stateOf(t.daemon)).toBe("InReview");
  });

  it("does not dispatch QA without the qa option", async () => {
    const t = await runQa({ qa: false });
    expect(t.runtime.requests).toHaveLength(0);
    expect(stateOf(t.daemon)).toBe("QA");
  });

  it("holds QA with IssueBudgetExceeded when the ledger leaves no room", async () => {
    const t = setup();
    const daemon = await boot(t);
    createLedgerRepository(daemon.db).record({
      projectId: "p",
      runId: "seed",
      day: "2026-11-05",
      costUsd: 2.5,
      costUnknown: false,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      issueId: 7,
      numTurns: null,
    });
    await daemon.ticker.tick();
    await daemon.ticker.idle();
    expect(t.runtime.requests).toHaveLength(0);
    expect(stateOf(daemon)).toBe("Held");
    const last = eventsOf(daemon, "StateChanged").at(-1)!;
    expect(last.runId).toBeNull();
    expect(last.payload).toMatchObject({
      trigger: "RunHeld",
      to: "Held",
      heldReason: "IssueBudgetExceeded",
    });
    expect(createRunRepository(daemon.db).list("p")).toHaveLength(0);
    expect(ledgerRows(daemon)).toHaveLength(1);
  });

  it("records maxBudgetUsd as cost when the QA cost is unknown", async () => {
    const t = await runQa({ results: [finished(pass, null)] });
    const rows = ledgerRows(t.daemon);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cost_usd: 1.5, cost_unknown: 1 });
  });

  it("passes the read port as third argument of qa.context", async () => {
    const seen: { projectId: string; types: string[]; state: string | undefined }[] = [];
    const context: QaCompose["context"] = (id, runId, read) => {
      seen.push({
        projectId: read.projectId,
        types: read.events.list(read.projectId, id).map((e) => e.type),
        state: read.issues.get(read.projectId, id)?.state,
      });
      return contextFor(id, runId, read);
    };
    await runQa({ context });
    expect(seen.length).toBeGreaterThan(0);
    const last = seen[seen.length - 1]!;
    expect(last.projectId).toBe("p");
    expect(last.types).toContain("WorkReported");
    expect(last.state).toBe("QA");
  });

  it("ignores agent and configRoot from the context (R4)", async () => {
    const hostile = ((id: number, runId: string, read: QaReadPort) => ({
      ...contextFor(id, runId, read)!,
      agent: { ...validAgent, bashAllow: ["rm -rf /"] },
      configRoot: "/tmp/hostile-worktree",
    })) as unknown as QaCompose["context"];
    const t = await runQa({ context: hostile });
    const request = t.runtime.requests[0]!;
    expect(request.agent).toEqual(validAgent);
    expect(request.configRoot).toBe(t.opts.root);
    expect(request.friday?.agent).toEqual({
      states: ["QA"],
      mcp_tools: ["qa_report", "issue_comment"],
    });
  });

  it("uses the dispatched runId in the request, events and ledger", async () => {
    const context: QaCompose["context"] = (id, runId, read) => {
      const base = contextFor(id, runId, read)!;
      return { ...base, friday: { ...base.friday, runId: "outro" } };
    };
    const t = await runQa({ context });
    const runs = createRunRepository(t.daemon.db).list("p");
    expect(runs).toHaveLength(1);
    const runId = runs[0]!.id;
    expect(t.runtime.requests[0]!.friday?.runId).toBe(runId);
    expect(eventsOf(t.daemon, "RunFinished").map((e) => e.runId)).toEqual([runId]);
    expect(ledgerRows(t.daemon).map((r) => r.run_id)).toEqual([runId]);
  });

  it.each([
    ["outside the root", () => "/tmp/fora"],
    ["the worktrees root itself", (root: string) => join(root, "worktrees")],
    [
      "a symbolic link to the outside",
      (root: string) => {
        const outside = mkdtempSync(join(tmpdir(), "friday-outside-"));
        mkdirSync(join(root, "worktrees"), { recursive: true });
        const link = join(root, "worktrees", "link");
        symlinkSync(outside, link);
        return link;
      },
    ],
  ])("refuses a worktree outside the worktrees root (%s)", async (_name, worktreeOf) => {
    const t = await runQa({ worktreeOf });
    expect(t.runtime.requests).toHaveLength(0);
    expect(stateOf(t.daemon)).toBe("QA");
    expect(t.logs.join("\n")).toContain(`O worktreePath ${t.worktree} está fora da raiz do daemon`);
  });

  it.each([
    ["context", { context: () => null }, "A issue 7 em QA não tem contexto para o QA"],
    ["criteria", { criteria: false }, "A issue 7 em QA não tem CriteriaSet válido"],
    ["work report", { report: false }, "A issue 7 em QA não tem WorkReported válido"],
  ] as [string, Over, string][])("logs and skips QA when the %s is missing", async (_n, o, msg) => {
    const t = await runQa(o);
    expect(t.runtime.requests).toHaveLength(0);
    expect(stateOf(t.daemon)).toBe("QA");
    expect(t.logs.join("\n")).toContain(msg);
  });
});

describe("QA agent config at startup", () => {
  const real = toAgentRunOptions({
    role: "qa",
    states: ["QA"],
    model: "sonnet",
    max_budget_usd: 1.5,
    max_turns: 40,
    timeout_s: 1800,
    tools: ["Read", "Glob", "Grep", "Bash"],
    mcp_tools: ["qa_report", "issue_comment"],
    bash_allow: ["pnpm test", "git diff origin/develop...HEAD"],
    output: "qaReport",
    prompt_file: "prompts/qa.md",
  } as Parameters<typeof toAgentRunOptions>[0]);
  const bad = (over: Partial<AgentRunOptions>) => ({ ...validAgent, ...over });
  const cases: [string, AgentRunOptions][] = [
    ["outputKind", bad({ outputKind: "verdict" as never })],
    ["states", bad({ states: ["QA", "Verify"] as never })],
    ["maxBudgetUsd", bad({ maxBudgetUsd: 0 })],
    ...[";", "&", "|", "<", ">", "`", "$(", "\n", "*"].map(
      (c) =>
        [`bashAllow ${JSON.stringify(c)}`, bad({ bashAllow: [`git log ${c} x`] })] as [
          string,
          AgentRunOptions,
        ],
    ),
    ["absolute promptFile", bad({ promptFile: "/etc/qa.md" })],
    ["promptFile with ..", bad({ promptFile: "../qa.md" })],
    ["tools", bad({ tools: ["Read", "Write"] as never })],
    ["allowedTools", bad({ allowedTools: ["mcp__friday__merge"] })],
  ];

  it.each(cases)("rejects an invalid QA agent config: %s", async (_name, agent) => {
    const t = setup({ agent });
    await expect(composeDaemon(t.opts)).rejects.toThrow("A ficha do QA é inválida.");
  });

  it("accepts a valid QA agent config", async () => {
    for (const agent of [validAgent, real]) {
      const t = setup({ agent });
      const daemon = await composeDaemon(t.opts);
      daemon.release();
    }
  });
});
