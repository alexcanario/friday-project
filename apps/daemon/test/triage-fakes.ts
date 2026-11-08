import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAgentRuntime, type AgentRunRequest, type IssueSummary } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import {
  createEventStore,
  createIssueRepository,
  createLedgerRepository,
  createRunRepository,
  openDatabase,
} from "@friday/infrastructure";
import { vi } from "vitest";
import { createRunRecorder } from "../src/index.ts";
import type { TriageDispatchDeps } from "../src/index.ts";
import { FakeGitHub } from "./fakes.ts";

export class FakeTriageGitHub extends FakeGitHub {
  readonly commentCalls: { issue: number; role: string; text: string }[] = [];
  readonly calls: string[] = [];
  postAgentCommentFailure: Error | null = null;

  override addLabel(issue: number, label: string): Promise<void> {
    this.calls.push(`addLabel:${issue}:${label}`);
    return super.addLabel(issue, label);
  }

  postAgentComment(issue: number, role: string, text: string): Promise<{ created: boolean }> {
    this.calls.push(`postAgentComment:${issue}:${role}`);
    this.commentCalls.push({ issue, role, text });
    return this.postAgentCommentFailure
      ? Promise.reject(this.postAgentCommentFailure)
      : Promise.resolve({ created: true });
  }
}

export const NOW = new Date("2026-11-05T03:00:00.000Z");
export const ISSUE: IssueSummary = {
  number: 10,
  title: "API de fotos",
  body: "Criar endpoint",
  labels: ["friday"],
};
export const FLOW = { model: "haiku", maxBudgetUsd: 0.5 } as const;
export const AGENT_CONFIG = { maxTurns: 3, timeoutMs: 120000, promptFile: "prompts/triage.md" };

export const finished = (
  output: unknown,
  status: RunFinished["status"] = "succeeded",
  costUsd: number | null = null,
): RunFinished => ({
  status,
  subtype: null,
  model: null,
  costUsd,
  tokens: null,
  numTurns: null,
  durationMs: null,
  output,
  violations: [],
});

export const GOOD = { specialist: "backend", reason: "Endpoint de API" };

type Opts = {
  state?: "Todo" | "Triage";
  results?: RunFinished[];
  labels?: string[];
  flow?: boolean;
  caps?: boolean;
  rejectRun?: boolean;
};

export function triageSetup(o: Opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "friday-triage-"));
  const db = openDatabase(join(dir, "friday.db"));
  db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p')").run();
  const events = createEventStore(db);
  const issues = createIssueRepository(db);
  const runs = createRunRepository(db);
  const ledger = createLedgerRepository(db);
  const issue = { ...ISSUE, labels: o.labels ?? ["friday"] };
  const stateChange = (from: string, to: string) =>
    events.append({
      projectId: "p",
      issueId: 10,
      runId: null,
      type: "StateChanged",
      actor: "daemon",
      at: NOW.toISOString(),
      payload: {
        type: "StateChanged",
        issueId: "10",
        from,
        to,
        trigger: "seed",
        heldReason: null,
        verifyRound: 0,
        qaRound: 0,
        reviewIter: 0,
      },
    });
  stateChange("Backlog", "Todo");
  if (o.state === "Triage") stateChange("Todo", "Triage");
  issues.rebuild("p");
  const github = new FakeTriageGitHub();
  const fake = new FakeAgentRuntime(o.results ?? [finished(GOOD)]);
  const runtime = {
    run: vi.fn((r: AgentRunRequest) =>
      o.rejectRun ? Promise.reject(new Error("queda")) : fake.run(r),
    ),
  };
  const recorderDeps = { projectId: "p", events, issues, now: () => NOW };
  const log = vi.fn<(m: string) => void>();
  const request = vi.fn((i: IssueSummary): AgentRunRequest => ({
    cwd: "/r/t",
    configRoot: "/r",
    prompt: `Issue #${i.number}`,
    agent: {
      model: "haiku",
      states: [],
      maxBudgetUsd: 0.5,
      maxTurns: 3,
      timeoutMs: 120000,
      tools: [],
      allowedTools: [],
      bashAllow: [],
      promptFile: "prompts/triage.md",
      outputKind: "triage",
    },
  }));
  const deps: TriageDispatchDeps = {
    projectId: "p",
    github,
    runtime,
    readFlow: () => (o.flow === false ? null : { ...FLOW }),
    readCaps: () => (o.caps === false ? null : { perDayUsd: 10, perIssueUsd: 5 }),
    request,
    recorder: recorderDeps,
    recording: {
      runs,
      recorder: createRunRecorder({ ...recorderDeps, ledger }),
      newRunId: () => "r1",
    },
    budget: { ledger, recorderDeps },
    now: () => NOW,
    log,
  };
  const stateEvents = () =>
    events
      .list("p", 10)
      .filter((e) => e.type === "StateChanged")
      .map((e) => e.payload as { from: string; to: string; heldReason: string | null })
      .slice(o.state === "Triage" ? 2 : 1);
  const row = () => issues.get("p", 10);
  return { db, events, runs, ledger, github, runtime, fake, deps, log, issue, stateEvents, row };
}
