// Run (PowerShell):
// $env:FRIDAY_LIVE="1"; $env:ANTHROPIC_API_KEY="<chave>"; pnpm --filter @friday/infrastructure exec vitest run test/specialist-init.live.test.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { toAgentRunOptions } from "@friday/application";
import { describe, expect, it } from "vitest";
import { ClaudeAgentSdkRuntime, GitHubRestAdapter, loadFactoryConfig } from "../src/index.ts";
import { createGitHubFake, createTestOctokit } from "./github-fake.ts";
import { initMatchesSheet } from "./live-helpers.ts";

type Init = { tools: string[]; mcp_servers: { name: string; status?: string }[] };

describe.skipIf(process.env.FRIDAY_LIVE !== "1")("specialist system/init (live, #126)", () => {
  it("exposes exactly the tools of the backend sheet", { timeout: 180_000 }, async () => {
    const registry = resolve(import.meta.dirname, "../../../registry");
    const r = loadFactoryConfig(registry);
    if (!r.ok) throw new Error("registro inválido");
    const backend = r.agents.backend;
    if (backend === undefined) throw new Error("ficha backend ausente");
    const cwd = mkdtempSync(resolve(tmpdir(), "friday-live-cwd-"));
    const recorded = new Set<string>();
    let init: Init | undefined;
    const runtime = new ClaudeAgentSdkRuntime({
      runs: { isActive: () => true },
      results: {
        has: (runId, kind) => recorded.has(`${runId}:${kind}`),
        record: (runId, kind) => void recorded.add(`${runId}:${kind}`),
      },
      github: new GitHubRestAdapter(createTestOctokit(createGitHubFake().fetch), {
        owner: "o",
        repo: "r",
      }),
      gitHost: {
        push: () => {
          throw new Error("gitHost não deve ser chamado");
        },
      },
      query: (params) =>
        (async function* () {
          for await (const message of query(params)) {
            if (message.type === "system" && message.subtype === "init") {
              init = message as unknown as Init;
              yield message;
              return;
            }
            yield message;
          }
        })(),
    });
    await runtime.run({
      cwd,
      configRoot: registry,
      prompt: "Apenas confirme que está pronto.",
      agent: { ...toAgentRunOptions(backend), model: "haiku", maxBudgetUsd: 0.05 },
      friday: {
        runId: "live-126",
        agent: backend,
        getIssueState: () => "InProgress",
        effects: {
          run: {
            issue: 1,
            role: "backend",
            branch: "friday/1-live",
            base: "develop",
            worktree: cwd,
            getPullRequest: () => null,
          },
        },
      },
    });
    if (init === undefined) throw new Error("system/init não recebido");
    expect(initMatchesSheet(init, backend)).toBe(true);
  });
});
