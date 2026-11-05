import type { Criteria, QaReport, RunFinished } from "@friday/contracts";
import type { AgentRunRequest, QaStepInput } from "../src/index.ts";

export const finished = (
  output: unknown,
  status: RunFinished["status"] = "succeeded",
): RunFinished => ({
  status,
  subtype: null,
  model: null,
  costUsd: null,
  tokens: null,
  numTurns: null,
  durationMs: null,
  output,
  violations: [],
});

export const makeRequest = (
  tools: string[] = ["Read", "Glob", "Grep", "Bash"],
  allowedTools: string[] = ["mcp__friday__qa_report"],
): AgentRunRequest => ({
  cwd: "/tmp/wt",
  prompt: "qa",
  configRoot: "/tmp/cfg",
  agent: {
    model: "sonnet",
    states: ["QA"],
    maxBudgetUsd: 1,
    maxTurns: 10,
    timeoutMs: 1000,
    tools,
    allowedTools,
    bashAllow: [],
    promptFile: "qa.md",
    outputKind: "qaReport",
  } as unknown as AgentRunRequest["agent"],
});

export const HEAD = "a".repeat(40);

export const makeCriteria = (
  kinds: Array<"command" | "browser"> = ["command", "command", "command"],
): Criteria["criteria"] =>
  kinds.map((kind, i) => ({
    index: i + 1,
    claim: `claim ${i + 1}`,
    proof: kind === "command" ? { kind, command: "pnpm test" } : { kind, step: "abrir a tela" },
  }));

export const makeInput = (over: Partial<QaStepInput> = {}): QaStepInput => ({
  request: makeRequest(),
  headSha: HEAD,
  criteria: makeCriteria(),
  changedFiles: ["src/a.ts"],
  screenPaths: [],
  ...over,
});

export const item = (
  index: number,
  result: "pass" | "fail" = "pass",
  screenshots: string[] = [],
  how = `how ${index}`,
) => ({
  index,
  result,
  how,
  screenshots,
});

export const passReport = (n = 3): QaReport =>
  ({
    verdict: "pass",
    criteria: Array.from({ length: n }, (_, i) => item(i + 1)),
    notChecked: [],
  }) as QaReport;
