import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  FakeGitHost,
  FakeGitHubPort,
  FakeResultStore,
  FakeRunLookup,
  type AgentRunRequest,
  type EffectsRun,
} from "@friday/application";
import { describe, expect, it } from "vitest";
import { ClaudeAgentSdkRuntime, createFridayMcpServer } from "../src/index.ts";
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

async function runWith(o: { push: boolean; headSha: string }) {
  let created: Captured | undefined;
  const query = async function* (_: { prompt: string; options: Options }) {
    if (o.push) await created!.handlers.git_push!({ branch: RUN.branch, message: "m" });
    yield init(["Read", "StructuredOutput"]);
    yield result({
      structured_output: { summary: "s", headSha: o.headSha, changedFiles: [], notDone: [] },
    }) as SDKMessage;
  };
  const runtime = new ClaudeAgentSdkRuntime({
    query,
    runs: new FakeRunLookup(["r1"]),
    results: new FakeResultStore(),
    github: new FakeGitHubPort(),
    gitHost: new FakeGitHost({ sha: B }),
    createMcpServer: (input) => (created = createFridayMcpServer(input)),
  });
  return runtime.run(request());
}

describe("ClaudeAgentSdkRuntime workReport headSha", () => {
  it("fills the workReport headSha from the last git_push", async () => {
    const pushed = await runWith({ push: true, headSha: "abc" });
    expect(pushed.status).toBe("succeeded");
    expect(pushed.violations).toEqual([]);
    expect((pushed.output as { headSha: string }).headSha).toBe(B);

    const invalid = await runWith({ push: false, headSha: "abc" });
    expect(invalid.status).toBe("invalid_output");
    expect(invalid.output).toBeNull();
    expect(invalid.violations[0]).toMatchObject({ code: "invalid_head_sha", path: "headSha" });

    const own = await runWith({ push: false, headSha: C });
    expect(own.status).toBe("succeeded");
    expect((own.output as { headSha: string }).headSha).toBe(C);
  });
});
