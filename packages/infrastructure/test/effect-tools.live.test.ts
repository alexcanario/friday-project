// Run (PowerShell): $env:FRIDAY_LIVE='1'; $env:FRIDAY_AUTHOR_TOKEN='<token do friday-author>'; $env:ANTHROPIC_API_KEY='<chave>'; $env:npm_config_manage_package_manager_versions='false'; npx -y pnpm@12.16.1 --filter @friday/infrastructure exec vitest run test/effect-tools.live.test.ts
// Prova real das ferramentas git_push, pr_create, pr_diff e issue_comment (#133, D56) por uma run real
// do especialista (haiku, teto 0,05 USD). Tokens e chave só no ambiente (D42, D89). Sem valores no código.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FakeResultStore,
  FakeRunLookup,
  type AgentRunOptions,
  type GitHost,
  type GitHubPort,
} from "@friday/application";
import { afterAll, describe, expect, it } from "vitest";
import {
  ClaudeAgentSdkRuntime,
  createGitHubClient,
  GitCliHost,
  GitHubRestAdapter,
} from "../src/index.ts";
import {
  prepareSandboxWorktree,
  SANDBOX,
  SANDBOX_URL,
  type SandboxWorktree,
} from "./live-sandbox-worktree.ts";

const LIVE = process.env.FRIDAY_LIVE === "1";
const TOKEN_ENV = "FRIDAY_AUTHOR_TOKEN";
const stamp = `${Date.now()}`;
const TOOLS = ["git_push", "pr_create", "pr_diff", "issue_comment"];
const calls: string[] = [];
const failures: string[] = [];

/** Records each method call that settles without throwing; the port is otherwise untouched. */
function recording<T extends object>(target: T, names: string[]): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver) as unknown;
      if (typeof value !== "function" || !names.includes(String(prop))) return value;
      return async (...args: unknown[]) => {
        const out = await (value as (...a: unknown[]) => Promise<unknown>).apply(obj, args);
        calls.push(String(prop));
        return out;
      };
    },
  });
}

const agent: AgentRunOptions = {
  model: "haiku",
  states: ["InProgress"],
  maxBudgetUsd: 0.05,
  maxTurns: 8,
  timeoutMs: 180_000,
  tools: [],
  allowedTools: TOOLS.map((t) => `mcp__friday__${t}`),
  bashAllow: [],
  promptFile: "prompt.md",
  outputKind: null,
};

describe.skipIf(!LIVE)("effect tools (live, #133)", () => {
  const cleanup: Array<() => Promise<unknown>> = [];
  let box: SandboxWorktree | undefined;
  let configRoot: string | undefined;

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step().catch(() => undefined);
    box?.dispose();
    if (configRoot !== undefined) rmSync(configRoot, { recursive: true, force: true });
  });

  it(
    "runs git_push, pr_create, pr_diff and issue_comment through a real specialist run",
    {
      timeout: 300_000,
    },
    async () => {
      const token = process.env[TOKEN_ENV];
      if (token === undefined || token.trim() === "") throw new Error(`Defina ${TOKEN_ENV}.`);
      const octokit = createGitHubClient(token);
      const made = await octokit.request("POST /repos/{owner}/{repo}/issues", {
        ...SANDBOX,
        title: `Teste vivo da #133 (${stamp})`,
      });
      const issue = made.data.number;
      cleanup.push(() =>
        octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
          ...SANDBOX,
          issue_number: issue,
          state: "closed",
        }),
      );
      const branch = `friday/${issue}-smoke`;
      cleanup.push(() =>
        octokit.request("DELETE /repos/{owner}/{repo}/git/refs/{ref}", {
          ...SANDBOX,
          ref: `heads/${branch}`,
        }),
      );
      box = await prepareSandboxWorktree(token, branch);
      mkdirSync(join(box.worktree, "live"), { recursive: true });
      writeFileSync(join(box.worktree, "live", `${stamp}.txt`), "ferramentas vivas da #133\n");

      const github = recording<GitHubPort>(new GitHubRestAdapter(octokit, SANDBOX), [
        "createPullRequest",
        "getPrReviewDiff",
        "postAgentComment",
      ]);
      const gitHost = recording<GitHost>(
        new GitCliHost({
          tokenEnv: TOKEN_ENV,
          repoDir: box.repoDir,
          mirrorDir: box.mirrorDir,
          targetUrl: SANDBOX_URL,
        }),
        ["push"],
      );
      let pr: number | null = null;
      cleanup.push(async () => {
        if (pr === null) return;
        await octokit.request("PATCH /repos/{owner}/{repo}/pulls/{pull_number}", {
          ...SANDBOX,
          pull_number: pr,
          state: "closed",
        });
      });

      configRoot = mkdtempSync(join(tmpdir(), "friday-live-cfg-"));
      writeFileSync(
        join(configRoot, "prompt.md"),
        "Você executa exatamente quatro chamadas de ferramenta, nesta ordem, sem outras: " +
          "git_push, pr_create, pr_diff, issue_comment. Depois responda 'pronto'.",
      );
      const runId = `live-${stamp}`;
      const out = await new ClaudeAgentSdkRuntime({
        github,
        gitHost,
        runs: new FakeRunLookup([runId]),
        results: new FakeResultStore(),
      }).run({
        cwd: box.worktree,
        configRoot,
        prompt:
          `Chame git_push com branch "${branch}" e message "test: ferramentas vivas da #133 (${stamp})". ` +
          `Depois pr_create com title "Teste vivo da #133 (${stamp})" e body "Teste vivo, será fechado." ` +
          `Depois pr_diff sem argumentos. Por fim issue_comment com body "Ferramentas de efeito ok." ` +
          `Se uma chamada falhar, pare e diga qual.`,
        agent,
        friday: {
          runId,
          agent: { states: ["InProgress"], mcp_tools: TOOLS } as never,
          getIssueState: () => "InProgress",
          effects: {
            run: {
              issue,
              role: "specialist",
              branch,
              base: "develop",
              worktree: box.worktree,
              getPullRequest: () => pr,
              onPrCreated: (n) => {
                pr = n;
              },
              onEffectError: (tool) => {
                failures.push(tool);
              },
            },
          },
        },
      });

      expect(["misconfigured", "failed"]).not.toContain(out.status);
      expect(failures).toEqual([]);
      expect(calls).toEqual(["push", "createPullRequest", "getPrReviewDiff", "postAgentComment"]);
      expect(pr).not.toBeNull();
      const comments = await octokit.request(
        "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
        { ...SANDBOX, issue_number: issue },
      );
      expect(comments.data.map((c) => c.body).join("\n")).toContain("Ferramentas de efeito ok.");
    },
  );
});
