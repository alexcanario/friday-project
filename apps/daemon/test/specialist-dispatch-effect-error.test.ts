import { describe, expect, it, vi } from "vitest";
import type { AgentRunRequest, DaySum, IssueRow, LedgerRepository } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import {
  buildSpecialistRequest,
  createRunRecorder,
  runSpecialistForIssue,
  type SpecialistDispatchDeps,
} from "../src/index.ts";
import { FakeEvents, FakeIssueRepository, FakeRunRepository } from "./fakes.ts";

const now = () => new Date("2026-11-07T03:00:00.000Z");
const agent = {
  model: "sonnet",
  states: ["InProgress"],
  maxBudgetUsd: 1,
  maxTurns: 5,
  timeoutMs: 60000,
  tools: ["Read"],
  allowedTools: ["mcp__friday__work_report"],
  bashAllow: [],
  promptFile: "backend.md",
  outputKind: "workReport",
} as unknown as Parameters<typeof buildSpecialistRequest>[0]["agent"];
const report = {
  summary: "Adiciona GET /version",
  headSha: "a".repeat(40),
  changedFiles: ["src/Version.cs"],
  notDone: [],
};
const finished: RunFinished = {
  status: "succeeded",
  subtype: null,
  model: null,
  costUsd: null,
  tokens: null,
  numTurns: null,
  durationMs: null,
  output: report,
  violations: [],
};
const request = buildSpecialistRequest({
  issue: { number: 7, title: "Adiciona GET /version", body: "Corpo" },
  criteria: null,
  feedback: null,
  agent,
  friday: {
    runId: "run-1",
    agent: { states: ["InProgress"], mcp_tools: ["work_report"] },
    getIssueState: () => "InProgress",
  },
  cwd: "/tmp/wt",
  configRoot: "/cfg",
  branch: "friday/7-version",
  base: "develop",
  getPullRequest: () => null,
}) as AgentRunRequest;

describe("runSpecialistForIssue effect errors", () => {
  it("logs the full effect error and keeps onPrCreated", async () => {
    const events = new FakeEvents();
    const issues = new FakeIssueRepository(events, undefined, { projectFromEvents: true });
    const row: IssueRow = {
      projectId: "p",
      issueId: 7,
      state: "InProgress",
      heldReason: null,
      verifyRound: 0,
      qaRound: 0,
      reviewIter: 0,
    };
    issues.rows.set(7, row);
    const seen: AgentRunRequest[] = [];
    const runtime = {
      run: (r: AgentRunRequest) => {
        seen.push(r);
        const run = r.friday!.effects!.run;
        run.onEffectError!("git_push", new Error("falha token=ghp_SEGREDO123"));
        run.onPrCreated!(42);
        return Promise.resolve(finished);
      },
    };
    const sum = (costUsd: number): DaySum => ({ costUsd, anyCostUnknown: false });
    const ledger: LedgerRepository = {
      record: () => undefined,
      sumByDay: () => sum(0),
      sumByIssue: () => sum(0),
    };
    const recorderDeps = { projectId: "p", events, issues, now };
    const log = vi.fn<(m: string) => void>();
    const deps: SpecialistDispatchDeps = {
      projectId: "p",
      targetOf: () => request,
      step: { runtime },
      recorder: recorderDeps,
      recording: {
        runs: new FakeRunRepository(),
        recorder: createRunRecorder(recorderDeps),
        newRunId: () => "run-1",
      },
      budget: { ledger, recorderDeps },
      caps: { perDayUsd: 100, perIssueUsd: 10 },
      now,
      prHead: () => Promise.reject(new Error("sem PR")),
      worktreeHead: () => Promise.resolve(null),
      isClean: () => Promise.resolve(true),
      align: () => Promise.resolve(false),
      log,
    };
    await runSpecialistForIssue(deps, 7);
    expect(seen).toHaveLength(1);
    const message = log.mock.calls.map((c) => c[0]).find((m) => m.includes("git_push"));
    expect(message).toContain("issue 7");
    expect(message).toContain("falha token=ghp_SEGREDO123");
    expect(events.appended.filter((e) => e.type === "PrOpened")).toHaveLength(1);
    expect(request.friday!.effects!.run.onEffectError).toBeUndefined();
  });
});
