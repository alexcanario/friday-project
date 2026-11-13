import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FakeGitHost,
  FakeGitHubPort,
  FakeResultStore,
  FakeRunLookup,
  type AgentRunOptions,
  type DaySum,
  type IssueRow,
  type LedgerRepository,
} from "@friday/application";
import {
  ClaudeAgentSdkRuntime,
  createFridayMcpServer,
  type ClaudeAgentSdkRuntimeDeps,
} from "@friday/infrastructure";
import {
  buildSpecialistRequest,
  createRunRecorder,
  runSpecialistForIssue,
  type SpecialistDispatchDeps,
} from "../src/index.ts";
import { feedbackOf } from "../src/specialist-request.ts";
import { FakeEvents, FakeIssueRepository, FakeRunRepository } from "./fakes.ts";

type QueryFn = NonNullable<ClaudeAgentSdkRuntimeDeps["query"]>;
type Message = ReturnType<QueryFn> extends AsyncIterable<infer M> ? M : never;
type Server = ReturnType<typeof createFridayMcpServer>;

const now = () => new Date("2026-11-12T03:00:00.000Z");
const OLD = "1".repeat(40);
const NEW = "2".repeat(40);
const BRANCH = "friday/7-version";
const agent = {
  model: "sonnet",
  states: ["InProgress"],
  maxBudgetUsd: 1,
  maxTurns: 5,
  timeoutMs: 60000,
  tools: ["Read"],
  allowedTools: ["mcp__friday__work_report", "mcp__friday__git_push"],
  bashAllow: [],
  promptFile: "backend.md",
  outputKind: "workReport",
} as unknown as AgentRunOptions;

function setup() {
  const configRoot = mkdtempSync(join(tmpdir(), "friday-rws-cfg-"));
  writeFileSync(join(configRoot, "backend.md"), "Você é o especialista backend.");
  const cwd = mkdtempSync(join(tmpdir(), "friday-rws-wt-"));
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events, undefined, { projectFromEvents: true });
  const row: IssueRow = {
    projectId: "p",
    issueId: 7,
    state: "InProgress",
    heldReason: null,
    verifyRound: 0,
    qaRound: 0,
    reviewIter: 1,
  };
  issues.rows.set(7, row);
  const at = now().toISOString();
  const seed = { projectId: "p", issueId: 7, runId: "run-0", actor: "daemon", at };
  events.append({
    ...seed,
    type: "WorkReported",
    payload: { worktreePath: cwd, headSha: OLD, changedFiles: [] },
  } as never);
  events.append({ ...seed, type: "JudgeFinished", payload: { feedback: "corrija X" } } as never);

  const prompts: string[] = [];
  let server: Server | undefined;
  const query: QueryFn = async function* ({ prompt }) {
    prompts.push(prompt);
    await server!.handlers.git_push!({ branch: BRANCH, message: "m" });
    yield {
      type: "system",
      subtype: "init",
      model: "m",
      tools: ["Read", "StructuredOutput"],
    } as unknown as Message;
    yield {
      type: "result",
      subtype: "success",
      is_error: false,
      total_cost_usd: 0.1,
      num_turns: 1,
      duration_ms: 1,
      structured_output: { summary: "s", headSha: OLD, changedFiles: ["a.cs"], notDone: [] },
    } as unknown as Message;
  };
  const runtime = new ClaudeAgentSdkRuntime({
    query,
    runs: new FakeRunLookup(["run-1"]),
    results: new FakeResultStore(),
    github: new FakeGitHubPort(),
    gitHost: new FakeGitHost({ sha: NEW }),
    createMcpServer: (input) => (server = createFridayMcpServer(input)),
  });
  const sum = (costUsd: number): DaySum => ({ costUsd, anyCostUnknown: false });
  const ledger: LedgerRepository = {
    record: () => undefined,
    sumByDay: () => sum(0),
    sumByIssue: () => sum(0),
  };
  const recorderDeps = { projectId: "p", events, issues, now };
  const recorder = createRunRecorder(recorderDeps);
  const deps: SpecialistDispatchDeps = {
    projectId: "p",
    targetOf: (_, runId) =>
      buildSpecialistRequest({
        issue: { number: 7, title: "Adiciona GET /version", body: "Corpo" },
        criteria: null,
        feedback: feedbackOf(events.list("p", 7)),
        agent,
        friday: {
          runId,
          agent: { states: ["InProgress"], mcp_tools: ["work_report", "git_push"] },
          getIssueState: () => "InProgress",
        },
        cwd,
        configRoot,
        branch: BRANCH,
        base: "develop",
        getPullRequest: () => null,
      }),
    step: { runtime },
    recorder: recorderDeps,
    recording: { runs: new FakeRunRepository(), recorder, newRunId: () => "run-1" },
    budget: { ledger, recorderDeps },
    caps: { perDayUsd: 100, perIssueUsd: 10 },
    now,
    prHead: () => Promise.reject(new Error("sem PR")),
    worktreeHead: () => Promise.resolve(null),
    isClean: () => Promise.resolve(true),
  };
  const ofType = (t: string) => events.appended.filter((e) => e.type === t);
  return { deps, issues, prompts, ofType };
}

describe("specialist rework with the real SDK runtime", () => {
  it("rework after ChangesRequested reports the pushed head and goes to Verify", async () => {
    const t = setup();
    const outcome = await runSpecialistForIssue(t.deps, 7);
    expect(outcome).toEqual({ applied: true, feedback: null });
    expect(t.prompts).toHaveLength(1);
    expect(t.prompts[0]).toContain("Feedback da rodada anterior:\ncorrija X");
    const reported = t.ofType("WorkReported");
    expect(reported).toHaveLength(2);
    expect((reported[1]!.payload as { headSha: string }).headSha).toBe(NEW);
    expect(t.ofType("RunHeld")).toHaveLength(0);
    expect(t.issues.rows.get(7)?.state).toBe("Verify");
  });

  it("RunFinished records the pushed headSha", async () => {
    const t = setup();
    await runSpecialistForIssue(t.deps, 7);
    const finished = t.ofType("RunFinished");
    expect(finished).toHaveLength(1);
    const payload = finished[0]!.payload as {
      status: string;
      violations: unknown[];
      output: { headSha: string };
    };
    expect(payload.status).toBe("succeeded");
    expect(payload.violations).toEqual([]);
    expect(payload.output.headSha).toBe(NEW);
    const reported = t.ofType("WorkReported");
    expect((reported[1]!.payload as { headSha: string }).headSha).toBe(payload.output.headSha);
  });
});
