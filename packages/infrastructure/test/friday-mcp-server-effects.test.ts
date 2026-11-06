import {
  FakeGitHost,
  FakeGitHubPort,
  FakeResultStore,
  FakeRunLookup,
  type EffectTool,
} from "@friday/application";
import type { AgentConfig } from "@friday/contracts";
import type { IssueState } from "@friday/domain";
import { describe, expect, it } from "vitest";
import { createFridayMcpServer } from "../src/index.ts";

const ALL: EffectTool[] = ["git_push", "pr_create", "pr_diff", "issue_comment"];
const SHA = "a".repeat(40);
const RUN = (pr: number | null = 7) => ({
  issue: 70,
  role: "specialist",
  branch: "friday/70-x",
  base: "develop",
  worktree: "/w",
  getPullRequest: () => pr,
});
const text = (t: string, isError?: true) => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError } : {}),
});
const FORBIDDEN = "403: Ferramenta não permitida para este papel ou estado da issue.";

function setup(
  opts: {
    tools?: AgentConfig["mcp_tools"];
    states?: AgentConfig["states"];
    state?: () => IssueState;
    active?: string[];
    github?: FakeGitHubPort;
    gitHost?: FakeGitHost;
    pr?: number | null;
  } = {},
) {
  const github = opts.github ?? new FakeGitHubPort();
  const gitHost = opts.gitHost ?? new FakeGitHost();
  const made = createFridayMcpServer({
    runId: "r1",
    agent: { states: opts.states ?? ["InProgress", "QA"], mcp_tools: opts.tools ?? ALL },
    getIssueState: opts.state ?? (() => "QA"),
    runs: new FakeRunLookup(opts.active ?? ["r1"]),
    results: new FakeResultStore(),
    effects: { github, gitHost, run: RUN(opts.pr === undefined ? 7 : opts.pr) },
  });
  return { ...made, github, gitHost };
}

describe("effect tools", () => {
  it("registers the effect tools only when listed and refuses a missing port", () => {
    const all = setup();
    expect(all.toolNames).toEqual(ALL.map((t) => `mcp__friday__${t}`));
    expect(Object.keys(all.handlers)).toEqual(ALL);
    const qa = setup({ tools: ["qa_report"] });
    expect(qa.toolNames).toEqual(["mcp__friday__qa_report"]);
    expect(qa.handlers.git_push).toBeUndefined();
    expect(() =>
      createFridayMcpServer({
        runId: "r1",
        agent: { states: ["QA"], mcp_tools: ["git_push"] },
        getIssueState: () => "QA",
        runs: new FakeRunLookup(["r1"]),
        results: new FakeResultStore(),
      }),
    ).toThrow("Porta ausente para a ferramenta git_push.");
  });

  it("calls the port once on valid input", async () => {
    const s = setup();
    expect(await s.handlers.git_push!({ branch: "friday/70-x", commit: SHA })).toEqual(
      text("200: push feito."),
    );
    expect(s.gitHost.pushes).toEqual([{ worktree: "/w", branch: "friday/70-x", commit: SHA }]);
    expect((await s.handlers.pr_create!({ title: "t", body: "b" })).isError).toBeUndefined();
    expect(await s.handlers.pr_diff!({})).toEqual(
      text(JSON.stringify({ files: [], diffBytes: 0 })),
    );
    expect(await s.handlers.issue_comment!({ body: "c" })).toEqual(
      text("200: comentário publicado."),
    );
    expect(s.github.calls).toEqual([
      {
        method: "createPullRequest",
        args: [{ head: "friday/70-x", base: "develop", title: "t", body: "b" }],
      },
      { method: "getPrDiff", args: [7] },
      { method: "postAgentComment", args: [70, "specialist", "c"] },
    ]);
  });

  it("rejects invalid input with 422 and never calls a port", async () => {
    const s = setup();
    const bad: Array<[EffectTool, unknown]> = [
      ["git_push", {}],
      ["git_push", { branch: "friday/70-x", commit: SHA, extra: 1 }],
      ["git_push", { branch: "friday/99-y", commit: SHA }],
      ["git_push", { branch: "friday/70-x", commit: "a".repeat(39) }],
      ["git_push", { branch: "friday/70-x", commit: "A".repeat(40) }],
      ["pr_create", { title: "t" }],
      ["pr_diff", { x: 1 }],
      ["issue_comment", {}],
    ];
    for (const [tool, args] of bad) {
      expect(await s.handlers[tool]!(args)).toEqual(
        text(`422: Entrada inválida para ${tool}.`, true),
      );
    }
    expect(s.gitHost.pushes).toEqual([]);
    expect(s.github.calls).toEqual([]);
    const none = setup({ pr: null });
    expect(await none.handlers.pr_diff!({})).toEqual(text("404: A run ainda não tem PR.", true));
    expect(none.github.calls).toEqual([]);
  });

  it("refuses with 403 and 404 without calling a port", async () => {
    let state: IssueState = "InReview";
    const s = setup({ state: () => state });
    const valid: Record<EffectTool, unknown> = {
      git_push: { branch: "friday/70-x", commit: SHA },
      pr_create: { title: "t", body: "b" },
      pr_diff: {},
      issue_comment: { body: "c" },
    };
    for (const tool of ALL)
      expect(await s.handlers[tool]!(valid[tool])).toEqual(text(FORBIDDEN, true));
    expect(s.gitHost.pushes).toEqual([]);
    expect(s.github.calls).toEqual([]);
    state = "QA";
    expect((await s.handlers.issue_comment!({ body: "c" })).isError).toBeUndefined();
    const review = setup({
      tools: ["issue_comment"],
      states: ["InReview"],
      state: () => "InReview",
    });
    expect(await review.handlers.issue_comment!({ body: "c" })).toEqual(text(FORBIDDEN, true));
    expect(review.github.calls).toEqual([]);
    const off = setup({ active: [] });
    expect(await off.handlers.pr_diff!({})).toEqual(text("404: A run não está ativa.", true));
    expect(off.github.calls).toEqual([]);
  });

  it("returns 500 when the port fails and keeps serving", async () => {
    const fail = new Error("falha simulada");
    const host = setup({ gitHost: new FakeGitHost({ fail }) });
    expect(await host.handlers.git_push!({ branch: "friday/70-x", commit: SHA })).toEqual(
      text("500: Falha ao executar git_push: falha simulada", true),
    );
    const gh = setup({ github: new FakeGitHubPort({ fail }) });
    expect(await gh.handlers.pr_create!({ title: "t", body: "b" })).toEqual(
      text("500: Falha ao executar pr_create: falha simulada", true),
    );
    expect(await gh.handlers.pr_diff!({})).toEqual(
      text("500: Falha ao executar pr_diff: falha simulada", true),
    );
    expect(await gh.handlers.issue_comment!({ body: "c" })).toEqual(
      text("500: Falha ao executar issue_comment: falha simulada", true),
    );
    let first = true;
    class Once extends FakeGitHost {
      override async push(r: Parameters<FakeGitHost["push"]>[0]): Promise<void> {
        const failNow = first;
        first = false;
        await super.push(r);
        if (failNow) throw fail;
      }
    }
    const once = setup({ gitHost: new Once() });
    const args = { branch: "friday/70-x", commit: SHA };
    expect((await once.handlers.git_push!(args)).isError).toBe(true);
    expect(await once.handlers.git_push!(args)).toEqual(text("200: push feito."));
  });

  it("returns the existing PR and allows a repeated push", async () => {
    const old = setup({
      github: new FakeGitHubPort({ createdPr: { number: 7, headSha: SHA, created: false } }),
    });
    expect(await old.handlers.pr_create!({ title: "t", body: "b" })).toEqual(
      text("200: PR #7 já existia."),
    );
    const fresh = setup({
      github: new FakeGitHubPort({ createdPr: { number: 7, headSha: SHA, created: true } }),
    });
    expect(await fresh.handlers.pr_create!({ title: "t", body: "b" })).toEqual(
      text("200: PR #7 aberto."),
    );
    const args = { branch: "friday/70-x", commit: SHA };
    expect(await fresh.handlers.git_push!(args)).toEqual(text("200: push feito."));
    expect(await fresh.handlers.git_push!(args)).toEqual(text("200: push feito."));
    expect(fresh.gitHost.pushes).toHaveLength(2);
  });
});

describe("effect tools through the MCP server", () => {
  type CallHandler = (
    req: { method: "tools/call"; params: { name: string; arguments: unknown } },
    extra: unknown,
  ) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
  const callViaMcp = (made: ReturnType<typeof setup>, name: string, args: unknown) => {
    const inner = (
      made.server as unknown as {
        instance: { server: { _requestHandlers: Map<string, CallHandler> } };
      }
    ).instance.server;
    const handler = inner._requestHandlers.get("tools/call")!;
    return handler({ method: "tools/call", params: { name, arguments: args } }, {});
  };

  it("rejects extra fields with 422 before calling any port", async () => {
    const made = setup();
    const push = await callViaMcp(made, "git_push", {
      branch: "friday/70-x",
      commit: SHA,
      extra: 1,
    });
    expect(push.isError).toBe(true);
    expect(push.content[0]!.text).toBe("422: Entrada inválida para git_push.");
    const diff = await callViaMcp(made, "pr_diff", { x: 1 });
    expect(diff.isError).toBe(true);
    expect(diff.content[0]!.text).toBe("422: Entrada inválida para pr_diff.");
    expect(made.gitHost.pushes).toEqual([]);
    expect(made.github.calls).toEqual([]);
  });

  it("still runs the effect on valid input through the MCP server", async () => {
    const made = setup();
    const push = await callViaMcp(made, "git_push", { branch: "friday/70-x", commit: SHA });
    expect(push.content[0]!.text).toBe("200: push feito.");
    expect(made.gitHost.pushes).toHaveLength(1);
  });
});
