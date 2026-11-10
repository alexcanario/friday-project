import {
  FakeGitHost,
  FakeGitHubPort,
  FakeResultStore,
  FakeRunLookup,
  type EffectTool,
  type GitHost,
} from "@friday/application";
import { describe, expect, it, vi } from "vitest";
import { createFridayMcpServer } from "../src/index.ts";

const ALL: EffectTool[] = ["git_push", "pr_create", "pr_diff", "issue_comment"];
const SECRET = "ghp_SEGREDO123";
const LEAKY = new Error(
  `push falhou token=${SECRET} url=https://x-access-token:${SECRET}@github.com/o/r.git`,
);
const ARGS: Record<EffectTool, unknown> = {
  git_push: { branch: "friday/70-x", message: "m" },
  pr_create: { title: "t", body: "b" },
  pr_diff: {},
  issue_comment: { body: "c" },
};
const fixed = (tool: string) => ({
  content: [{ type: "text", text: `500: Falha ao executar ${tool} (effect_failed).` }],
  isError: true,
});

function setup(
  opts: {
    fail?: unknown;
    onEffectError?: (tool: EffectTool, error: unknown) => void;
    state?: "QA" | "Done";
  } = {},
) {
  const fail = opts.fail ?? LEAKY;
  const gitHost: GitHost = {
    push: () => Promise.reject(fail),
  } as unknown as GitHost;
  const github = new FakeGitHubPort(fail instanceof Error ? { fail } : undefined);
  const ghFail = fail instanceof Error ? github : rejectingGithub(fail);
  const made = createFridayMcpServer({
    runId: "r1",
    agent: { states: ["QA"], mcp_tools: ALL },
    getIssueState: () => opts.state ?? "QA",
    runs: new FakeRunLookup(["r1"]),
    results: new FakeResultStore(),
    effects: {
      github: ghFail,
      gitHost,
      run: {
        issue: 70,
        role: "specialist",
        branch: "friday/70-x",
        base: "develop",
        worktree: "/w",
        getPullRequest: () => 7,
        ...(opts.onEffectError ? { onEffectError: opts.onEffectError } : {}),
      },
    },
  });
  return made;
}

function rejectingGithub(fail: unknown): FakeGitHubPort {
  const g = new FakeGitHubPort();
  const reject = () => Promise.reject(fail);
  g.createPullRequest = reject as unknown as FakeGitHubPort["createPullRequest"];
  g.getPrDiff = reject as unknown as FakeGitHubPort["getPrDiff"];
  g.postAgentComment = reject as unknown as FakeGitHubPort["postAgentComment"];
  return g;
}

describe("effect tools port failure", () => {
  it("returns a fixed 500 message for each effect tool", async () => {
    const s = setup();
    for (const tool of ALL) expect(await s.handlers[tool]!(ARGS[tool])).toEqual(fixed(tool));
  });

  it("never leaks token, credential URL or error text", async () => {
    const s = setup();
    for (const tool of ALL) {
      const res = await s.handlers[tool]!(ARGS[tool]);
      const out = res.content[0]!.text;
      expect(out).not.toContain(SECRET);
      expect(out).not.toContain("x-access-token");
      expect(out).not.toContain("https://");
      expect(out).not.toContain("push falhou");
    }
  });

  it("handles a non-Error throw without leaking", async () => {
    const s = setup({ fail: `token=${SECRET}` });
    for (const tool of ALL) {
      const res = await s.handlers[tool]!(ARGS[tool]);
      expect(res).toEqual(fixed(tool));
      expect(res.content[0]!.text).not.toContain(SECRET);
    }
  });

  it("calls onEffectError only when the port fails", async () => {
    const hook = vi.fn();
    const s = setup({ onEffectError: hook });
    await s.handlers.git_push!(ARGS.git_push);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith("git_push", LEAKY);
    const ok = createFridayMcpServer({
      runId: "r1",
      agent: { states: ["QA"], mcp_tools: ALL },
      getIssueState: () => "QA",
      runs: new FakeRunLookup(["r1"]),
      results: new FakeResultStore(),
      effects: {
        github: new FakeGitHubPort(),
        gitHost: new FakeGitHost(),
        run: {
          issue: 70,
          role: "specialist",
          branch: "friday/70-x",
          base: "develop",
          worktree: "/w",
          getPullRequest: () => 7,
          onEffectError: hook,
        },
      },
    });
    await ok.handlers.git_push!(ARGS.git_push);
    await ok.handlers.git_push!({ branch: "outra", message: "m" });
    expect(hook).toHaveBeenCalledTimes(1);
    const off = setup({ onEffectError: hook, state: "Done" });
    await off.handlers.git_push!(ARGS.git_push);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("survives a throwing onEffectError hook", async () => {
    const hook = vi.fn(() => {
      throw new Error(`log falhou ${SECRET}`);
    });
    const s = setup({ onEffectError: hook });
    expect(await s.handlers.git_push!(ARGS.git_push)).toEqual(fixed("git_push"));
    expect(await s.handlers.issue_comment!(ARGS.issue_comment)).toEqual(fixed("issue_comment"));
    expect(hook).toHaveBeenCalledTimes(2);
  });

  it("works without onEffectError", async () => {
    const s = setup();
    expect(await s.handlers.pr_create!(ARGS.pr_create)).toEqual(fixed("pr_create"));
  });
});
