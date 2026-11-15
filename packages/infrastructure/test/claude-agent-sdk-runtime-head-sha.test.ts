import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  FakeGitHost,
  FakeGitHubPort,
  FakeResultStore,
  FakeRunLookup,
  type AgentRunRequest,
  type EffectsRun,
  type GitHost,
} from "@friday/application";
import { describe, expect, it } from "vitest";
import { ClaudeAgentSdkRuntime, createFridayMcpServer } from "../src/index.ts";
import { classify, type ResultMessage, type RunObservation } from "../src/run-result.ts";
import { init, result } from "./runtime-helpers.ts";

const RUN: EffectsRun = {
  issue: 96,
  role: "specialist",
  branch: "friday/96-x",
  base: "develop",
  worktree: "/w",
  getPullRequest: () => 7,
};
const B = "b".repeat(40);
const C = "c".repeat(40);

type Captured = ReturnType<typeof createFridayMcpServer>;

function request(): AgentRunRequest {
  const configRoot = mkdtempSync(join(tmpdir(), "friday-hs-cfg-"));
  writeFileSync(join(configRoot, "prompt.md"), "Você é o especialista.");
  const cwd = mkdtempSync(join(tmpdir(), "friday-hs-wt-"));
  return {
    cwd,
    configRoot,
    prompt: "faça",
    agent: {
      model: "sonnet",
      states: ["InProgress"],
      maxBudgetUsd: 0.5,
      maxTurns: 10,
      timeoutMs: 60000,
      tools: ["Read"],
      allowedTools: ["mcp__friday__work_report", "mcp__friday__git_push"],
      bashAllow: [],
      promptFile: "prompt.md",
      outputKind: "workReport",
    },
    friday: {
      runId: "r1",
      agent: { states: ["InProgress"], mcp_tools: ["work_report", "git_push"] },
      getIssueState: () => "InProgress",
      effects: { run: RUN },
    },
  };
}

interface RunOptions {
  pushes: number;
  gitHost?: GitHost;
  outputKind?: "workReport" | "reviewVerdict";
  structured?: unknown;
  headSha: string;
  headFallback?: string;
}

async function runWith(o: RunOptions) {
  let created: Captured | undefined;
  const query = async function* () {
    for (let i = 0; i < o.pushes; i++) {
      await created!.handlers.git_push!({ branch: RUN.branch, message: "m" });
    }
    yield init(["Read", "StructuredOutput"]);
    yield result({
      structured_output: o.structured ?? {
        summary: "s",
        headSha: o.headSha,
        changedFiles: [],
        notDone: [],
      },
    }) as SDKMessage;
  };
  const runtime = new ClaudeAgentSdkRuntime({
    query,
    runs: new FakeRunLookup(["r1"]),
    results: new FakeResultStore(),
    github: new FakeGitHubPort(),
    gitHost: o.gitHost ?? new FakeGitHost({ sha: B }),
    createMcpServer: (input) => (created = createFridayMcpServer(input)),
  });
  const base = request();
  const agent = { ...base.agent, outputKind: o.outputKind ?? "workReport" };
  const withAgent = { ...base, agent };
  return runtime.run(
    o.headFallback === undefined ? withAgent : { ...withAgent, headFallback: o.headFallback },
  );
}

describe("ClaudeAgentSdkRuntime workReport headSha", () => {
  it("fills the workReport headSha from the last git_push", async () => {
    const pushed = await runWith({ pushes: 1, headSha: "abc" });
    expect(pushed.status).toBe("succeeded");
    expect(pushed.violations).toEqual([]);
    expect((pushed.output as { headSha: string }).headSha).toBe(B);

    const invalid = await runWith({ pushes: 0, headSha: "abc" });
    expect(invalid.status).toBe("invalid_output");
    expect(invalid.output).toBeNull();
    expect(invalid.violations[0]).toMatchObject({ code: "invalid_head_sha", path: "headSha" });

    const own = await runWith({ pushes: 0, headSha: C });
    expect(own.status).toBe("succeeded");
    expect((own.output as { headSha: string }).headSha).toBe(C);
  });
});

const WORK_AGENT = request().agent;

function observe(over: Partial<RunObservation>, structured: unknown): RunObservation {
  return {
    model: "m",
    initSeen: true,
    toolViolation: false,
    result: result({ structured_output: structured }) as ResultMessage,
    timedOut: false,
    pushedSha: null,
    headFallback: null,
    ...over,
  };
}

const report = (headSha: string) => ({ summary: "s", headSha, changedFiles: [], notDone: [] });
const headOf = (finished: { output: unknown }) => (finished.output as { headSha: string }).headSha;

describe("classify headFallback", () => {
  it("usa o headFallback quando não houve push", () => {
    const finished = classify(observe({ headFallback: B }, report("abc")), WORK_AGENT);
    expect(finished.status).toBe("succeeded");
    expect(headOf(finished)).toBe(B);
  });

  it("o SHA do push vence o headFallback", () => {
    const finished = classify(
      observe({ pushedSha: C, headFallback: B }, report("abc")),
      WORK_AGENT,
    );
    expect(headOf(finished)).toBe(C);
  });

  it("sem push e sem fallback mantém invalid_head_sha", () => {
    const finished = classify(observe({}, report("abc")), WORK_AGENT);
    expect(finished.status).toBe("invalid_output");
    expect(finished.violations[0]).toMatchObject({ code: "invalid_head_sha" });
  });

  it("o headFallback não afeta saídas que não são workReport", () => {
    const verdict = { verdict: "approve", findings: [] };
    const agent = { ...WORK_AGENT, outputKind: "reviewVerdict" as const };
    const withFallback = classify(observe({ headFallback: B }, verdict), agent);
    const without = classify(observe({}, verdict), agent);
    expect(withFallback).toEqual(without);
  });

  it("o headFallback substitui um headSha válido do agente", () => {
    const finished = classify(observe({ headFallback: B }, report("a".repeat(40))), WORK_AGENT);
    expect(headOf(finished)).toBe(B);
  });
});

describe("ClaudeAgentSdkRuntime headFallback", () => {
  it("o runtime repassa o headFallback do pedido", async () => {
    const without = await runWith({ pushes: 0, headSha: "abc" });
    expect(without.status).toBe("invalid_output");
    const finished = await runWith({ pushes: 0, headSha: "abc", headFallback: B });
    expect(finished.status).toBe("succeeded");
    expect(headOf(finished)).toBe(B);
  });
});

describe("classify headSha guards", () => {
  it("does not spread an array structured_output", () => {
    const withPush = classify(observe({ pushedSha: B }, []), WORK_AGENT);
    const without = classify(observe({ pushedSha: null, headFallback: null }, []), WORK_AGENT);
    expect(withPush.status).toBe("invalid_output");
    expect(withPush.output).toBeNull();
    expect(withPush.violations).toEqual(without.violations);
  });

  it("still replaces headSha on a plain object", () => {
    const finished = classify(observe({ pushedSha: B }, report("abc")), WORK_AGENT);
    expect(finished.status).toBe("succeeded");
    expect(headOf(finished)).toBe(B);
  });
});

function sequencedHost(steps: Array<string | Error>): GitHost {
  return {
    push: async () => {
      const next = steps.shift()!;
      if (next instanceof Error) throw next;
      return { sha: next };
    },
  };
}

describe("ClaudeAgentSdkRuntime headSha edges", () => {
  it("uses the last of several pushes", async () => {
    const gitHost = sequencedHost([B, C]);
    const finished = await runWith({ pushes: 2, gitHost, headSha: "abc" });
    expect(finished.status).toBe("succeeded");
    expect(headOf(finished)).toBe(C);
    const single = await runWith({ pushes: 1, gitHost: sequencedHost([B]), headSha: "abc" });
    expect(headOf(single)).toBe(B);
  });

  it("keeps the successful push when a later push fails", async () => {
    const gitHost = sequencedHost([B, new Error("push falhou")]);
    const finished = await runWith({ pushes: 2, gitHost, headSha: "abc" });
    expect(finished.status).toBe("succeeded");
    expect(headOf(finished)).toBe(B);
  });

  it("does not touch headSha of a reviewVerdict run", async () => {
    const A = "a".repeat(40);
    const structured = {
      verdict: "approve",
      headSha: A,
      rules: [1, 2, 3, 4, 5].map((rule) => ({ rule, answer: "yes", evidence: "ok" })),
      findings: [],
      risk: "low",
    };
    const finished = await runWith({
      pushes: 1,
      outputKind: "reviewVerdict",
      structured,
      headSha: A,
    });
    expect(finished.status).toBe("succeeded");
    expect(headOf(finished)).toBe(A);
  });
});
