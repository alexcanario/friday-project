import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeGitHost, FakeGitHubPort, FakeResultStore } from "@friday/application";
import {
  ClaudeAgentSdkRuntime,
  createFridayMcpServer,
  type ClaudeAgentSdkRuntimeDeps,
} from "@friday/infrastructure";
import { runJudgeForIssue } from "../src/judge-dispatch.ts";
import { B, row, setup, verdict } from "./judge-dispatch-helpers.ts";

type QueryFn = NonNullable<ClaudeAgentSdkRuntimeDeps["query"]>;
type Options = Parameters<QueryFn>[0]["options"];
type Server = ReturnType<typeof createFridayMcpServer>;
type Message = ReturnType<QueryFn> extends AsyncIterable<infer M> ? M : never;

const MESSAGES = [
  { type: "system", subtype: "init", model: "m", tools: ["Read", "StructuredOutput"] },
  { type: "result", subtype: "success", is_error: false, total_cost_usd: 0.1, num_turns: 1 },
] as unknown as Message[];

const created: string[] = [];

afterEach(() => {
  for (const p of created) rmSync(p, { recursive: true, force: true });
});

/** The real SDK runtime over a fake `query` that captures the options and the created server. */
function session(o: { dropFriday?: boolean; noPr?: boolean; pr?: number } = {}) {
  const t = setup(o.pr === undefined ? {} : { pr: o.pr });
  const configRoot = mkdtempSync(join(tmpdir(), "friday-jms-cfg-"));
  created.push(configRoot);
  writeFileSync(join(configRoot, "judge.md"), "Você é o Judge.");
  const cwd = mkdtempSync(join(tmpdir(), "friday-jms-wt-"));
  created.push(cwd);
  const options: Options[] = [];
  const servers: Server[] = [];
  const query: QueryFn = async function* ({ options: o2 }) {
    options.push(o2);
    for (const m of MESSAGES) yield m;
  };
  const github = new FakeGitHubPort({
    prReviewDiff: { headSha: B, truncated: false, files: [] },
  });
  const sdk = new ClaudeAgentSdkRuntime({
    query,
    runs: { isActive: () => true },
    results: new FakeResultStore(),
    github,
    gitHost: new FakeGitHost(),
    createMcpServer: (input) => {
      const created = createFridayMcpServer(input);
      servers.push(created);
      return created;
    },
  });
  const runtime = {
    run: (r: Parameters<typeof sdk.run>[0]) => {
      if (o.dropFriday) return sdk.run({ ...r, friday: undefined });
      if (o.noPr && r.friday?.effects !== undefined) {
        const effects = { run: { ...r.friday.effects.run, getPullRequest: () => null } };
        return sdk.run({ ...r, friday: { ...r.friday, effects } });
      }
      return sdk.run(r);
    },
  };
  const deps = {
    ...t.deps,
    judgeInput: () => ({ cwd, prompt: "judge", configRoot }),
    step: { ...t.deps.step, runtime },
  };
  return { t, options, servers, github, start: () => runJudgeForIssue(deps, 7) };
}

const text = (r: unknown): string => (r as { content: Array<{ text: string }> }).content[0]!.text;

describe("judge session with the real SDK runtime", () => {
  it("the judge session exposes the friday server and both tools", async () => {
    const s = session();
    await s.start();
    expect(s.options).toHaveLength(1);
    expect(Object.keys(s.options[0]!.mcpServers ?? {})).toEqual(["friday"]);
    const friday = (s.options[0]!.allowedTools ?? []).filter((n) => n.startsWith("mcp__friday__"));
    expect(friday.sort()).toEqual(["mcp__friday__pr_diff", "mcp__friday__review_verdict"]);
    // Control: without friday in the request the server is missing (the defect of #417).
    const broken = session({ dropFriday: true });
    await broken.start();
    expect(broken.options).toHaveLength(1);
    expect(broken.options[0]!.mcpServers).toBeUndefined();
  });

  it("pr_diff returns the patch of the pull request head or 404 without a pull request", async () => {
    const s = session({ pr: 14 });
    await s.start();
    const ok = await s.servers[0]!.handlers.pr_diff!({});
    expect((JSON.parse(text(ok)) as { headSha: string }).headSha).toBe(B);
    const diffCalls = s.github.calls.filter((c) => c.method === "getPrReviewDiff");
    expect(diffCalls.map((c) => c.args)).toEqual([[14]]);
    const none = session({ noPr: true });
    await none.start();
    const missing = await none.servers[0]!.handlers.pr_diff!({});
    expect(text(missing)).toBe("404: A run ainda não tem PR.");
    expect(none.github.calls.some((c) => c.method === "getPrReviewDiff")).toBe(false);
  });

  it("review_verdict is accepted in InReview and denied in QA", async () => {
    const s = session();
    await s.start();
    const handler = s.servers[0]!.handlers.review_verdict!;
    s.t.issues.row = row("QA");
    const denied = await handler(verdict({ headSha: B }));
    expect(text(denied).startsWith("403:")).toBe(true);
    expect((denied as { isError?: boolean }).isError).toBe(true);
    s.t.issues.row = row("InReview");
    const accepted = await handler(verdict({ headSha: B }));
    expect(text(accepted).startsWith("200:")).toBe(true);
  });

  it("removes its temporary folders after each test", () => {
    // The previous tests already ran their afterEach; this one checks what they left.
    expect(created.length).toBeGreaterThan(0);
    for (const p of created) expect(existsSync(p)).toBe(false);
  });
});
