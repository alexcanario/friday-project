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
import { init, makeRequest, result } from "./runtime-helpers.ts";

const TOOLS = ["git_push", "pr_create", "pr_diff", "issue_comment"];
const EFFECT_AGENT = { states: ["InProgress"], mcp_tools: TOOLS } as const;
const QA_AGENT = { states: ["QA"], mcp_tools: ["qa_report"] } as const;
const ALLOWED = TOOLS.map((t) => `mcp__friday__${t}`);
const RUN: EffectsRun = {
  issue: 96,
  role: "specialist",
  branch: "friday/96-x",
  base: "develop",
  worktree: "/w",
  getPullRequest: () => 7,
};
const MESSAGES = [init(["Read", "StructuredOutput"]), result()] as SDKMessage[];

type Input = Parameters<typeof createFridayMcpServer>[0];
type Captured = ReturnType<typeof createFridayMcpServer>;

type Call = { value?: unknown; error?: unknown };

function setup(onCall?: (c: Captured) => Promise<unknown>) {
  const calls: Call[] = [];
  const queries: Options[] = [];
  const inputs: Input[] = [];
  const created: Captured[] = [];
  const github = new FakeGitHubPort();
  const gitHost = new FakeGitHost();
  const createMcpServer = ((input: Input) => {
    inputs.push(input);
    const c = createFridayMcpServer(input);
    created.push(c);
    return c;
  }) as typeof createFridayMcpServer;
  const query = async function* ({ options }: { prompt: string; options: Options }) {
    queries.push(options);
    if (onCall) {
      try {
        calls.push({ value: await onCall(created[0]!) });
      } catch (error) {
        calls.push({ error });
      }
    }
    for (const m of MESSAGES) yield m;
  };
  const deps = {
    query,
    runs: new FakeRunLookup(["r1"]),
    results: new FakeResultStore(),
    createMcpServer,
  };
  return { calls, queries, inputs, created, github, gitHost, deps };
}

const request = (
  over: {
    agent?: { states: readonly string[]; mcp_tools: readonly string[] };
    allowedTools?: string[];
    effects?: { run: EffectsRun } | null;
    state?: string;
  } = {},
): AgentRunRequest => {
  const effects = over.effects === undefined ? { run: RUN } : over.effects;
  return {
    ...makeRequest({ allowedTools: over.allowedTools ?? ALLOWED }),
    friday: {
      runId: "r1",
      agent: (over.agent ?? EFFECT_AGENT) as never,
      getIssueState: () => (over.state ?? "InProgress") as never,
      ...(effects === null ? {} : { effects }),
    },
  };
};

describe("ClaudeAgentSdkRuntime effect tools", () => {
  it("passes github, gitHost and the run as effects to the friday server", async () => {
    const s = setup();
    const runtime = new ClaudeAgentSdkRuntime({ ...s.deps, github: s.github, gitHost: s.gitHost });
    await runtime.run(request());
    expect(s.inputs).toHaveLength(1);
    expect(s.inputs[0]!.effects!.github).toBe(s.github);
    expect(s.inputs[0]!.effects!.gitHost).toBe(s.gitHost);
    expect(s.inputs[0]!.effects!.run).toBe(RUN);
    expect(s.queries).toHaveLength(1);
    expect(Object.keys(s.queries[0]!.mcpServers!)).toEqual(["friday"]);
  });

  it("runs the four effect tools against the fake ports end to end", async () => {
    const s = setup(async (c) => {
      const h = c.handlers;
      return [
        await h.git_push!({ branch: "friday/96-x", message: "m" }),
        await h.pr_create!({ title: "t", body: "b" }),
        await h.pr_diff!({}),
        await h.issue_comment!({ body: "c" }),
      ];
    });
    const runtime = new ClaudeAgentSdkRuntime({ ...s.deps, github: s.github, gitHost: s.gitHost });
    await runtime.run(request());
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.error).toBeUndefined();
    const outs = s.calls[0]!.value as Array<{ isError?: boolean }>;
    expect(outs).toHaveLength(4);
    for (const o of outs) expect(o.isError).toBeUndefined();
    expect(s.gitHost.pushes).toEqual([{ worktree: "/w", branch: "friday/96-x", message: "m" }]);
    expect(s.github.calls).toEqual([
      {
        method: "createPullRequest",
        args: [{ head: "friday/96-x", base: "develop", title: "t", body: "b" }],
      },
      { method: "getPrReviewDiff", args: [7] },
      { method: "postAgentComment", args: [96, "specialist", "c"] },
    ]);
  });

  it("pr_diff returns headSha and patch from getPrReviewDiff", async () => {
    const prReviewDiff = {
      headSha: "c".repeat(40),
      truncated: false,
      files: [{ path: "a.ts", changedLines: 2, hasPatch: true, patch: "@@ -1 +1 @@" }],
    };
    const github = new FakeGitHubPort({ prReviewDiff });
    const s = setup(async (c) => c.handlers.pr_diff!({}));
    const runtime = new ClaudeAgentSdkRuntime({ ...s.deps, github, gitHost: s.gitHost });
    await runtime.run(request());
    expect(s.calls[0]!.value).toEqual({
      content: [{ type: "text", text: JSON.stringify(prReviewDiff) }],
    });
    expect(github.calls).toEqual([{ method: "getPrReviewDiff", args: [7] }]);

    const none = setup(async (c) => c.handlers.pr_diff!({}));
    const rt = new ClaudeAgentSdkRuntime({ ...none.deps, github, gitHost: none.gitHost });
    await rt.run(request({ effects: { run: { ...RUN, getPullRequest: () => null } } }));
    expect(none.calls[0]!.value).toEqual({
      content: [{ type: "text", text: "404: A run ainda não tem PR." }],
      isError: true,
    });
  });

  it("is misconfigured when an effect tool lacks a port or the run", async () => {
    const one = { agent: { states: ["InProgress"], mcp_tools: ["issue_comment"] } };
    for (const base of [{}, { ...one, allowedTools: ["mcp__friday__issue_comment"] }]) {
      const s = setup();
      const full = { github: s.github, gitHost: s.gitHost };
      const cases: Array<[Record<string, unknown>, ReturnType<typeof request>]> = [
        [{ gitHost: s.gitHost }, request(base)],
        [{ github: s.github }, request(base)],
        [full, request({ ...base, effects: null })],
      ];
      for (const [ports, req] of cases) {
        const runtime = new ClaudeAgentSdkRuntime({ ...s.deps, ...ports });
        expect((await runtime.run(req)).status).toBe("misconfigured");
      }
      expect(s.inputs).toHaveLength(0);
      expect(s.queries).toHaveLength(0);
    }
  });

  it("does not require effects for result tools only", async () => {
    for (const effects of [{ run: RUN }, null]) {
      const s = setup();
      const runtime = new ClaudeAgentSdkRuntime(s.deps);
      const r = await runtime.run(
        request({ agent: QA_AGENT, allowedTools: ["mcp__friday__qa_report"], effects }),
      );
      expect(r.status).not.toBe("misconfigured");
      expect(s.queries).toHaveLength(1);
      expect("effects" in s.inputs[0]!).toBe(false);
    }
  });

  it("leaves the server out without request.friday", async () => {
    const s = setup();
    const runtime = new ClaudeAgentSdkRuntime({ ...s.deps, github: s.github, gitHost: s.gitHost });
    await runtime.run(makeRequest());
    expect("mcpServers" in s.queries[0]!).toBe(false);
    expect(s.inputs).toHaveLength(0);
  });

  it("reads the issue state and the pull request on every call", async () => {
    const s = setup(async (c) => {
      return c.handlers.git_push!({ branch: "friday/96-x", message: "m" });
    });
    const runtime = new ClaudeAgentSdkRuntime({ ...s.deps, github: s.github, gitHost: s.gitHost });
    await runtime.run(request({ state: "InReview" }));
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.error).toBeUndefined();
    expect(s.calls[0]!.value).toEqual({
      content: [
        {
          type: "text",
          text: "403: Ferramenta não permitida para este papel ou estado da issue.",
        },
      ],
      isError: true,
    });
    expect(s.gitHost.pushes).toEqual([]);

    const t = setup(async (c) => {
      await c.handlers.pr_diff!({});
    });
    const other = new ClaudeAgentSdkRuntime({ ...t.deps, github: t.github, gitHost: t.gitHost });
    await other.run(request({ effects: { run: { ...RUN, getPullRequest: () => 9 } } }));
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.error).toBeUndefined();
    expect(t.github.calls).toEqual([{ method: "getPrReviewDiff", args: [9] }]);
  });
});
