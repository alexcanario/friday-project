// Run (PowerShell):
// $env:FRIDAY_LIVE="1"; $env:ANTHROPIC_API_KEY="<chave>"; pnpm --filter @friday/infrastructure exec vitest run test/friday-mcp.live.test.ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { ClaudeAgentSdkRuntime } from "../src/index.ts";
import { secondCallDenied } from "./live-helpers.ts";

function toolResultTexts(message: SDKMessage): string[] {
  if (message.type !== "user") return [];
  const content: unknown = message.message.content;
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content as { type?: string; content?: unknown }[]) {
    if (block.type !== "tool_result" || !Array.isArray(block.content)) continue;
    for (const item of block.content as { type?: string; text?: string }[]) {
      if (item.type === "text" && typeof item.text === "string") texts.push(item.text);
    }
  }
  return texts;
}

describe.skipIf(process.env.FRIDAY_LIVE !== "1")("friday MCP server (live, #93)", () => {
  it("denies the second work_report call of the same run", { timeout: 180_000 }, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "friday-live-cwd-"));
    const configRoot = mkdtempSync(join(tmpdir(), "friday-live-cfg-"));
    writeFileSync(
      join(configRoot, "prompt.md"),
      "Use as ferramentas pedidas, com valores de exemplo.",
    );
    const recorded = new Set<string>();
    const texts: string[] = [];
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const runtime = new ClaudeAgentSdkRuntime({
      runs: { isActive: () => true },
      results: {
        has: (runId, kind) => recorded.has(`${runId}:${kind}`),
        record: (runId, kind) => void recorded.add(`${runId}:${kind}`),
      },
      query: (params) =>
        (async function* () {
          for await (const message of query(params)) {
            texts.push(...toolResultTexts(message));
            yield message;
          }
        })(),
    });
    await runtime.run({
      cwd,
      configRoot,
      prompt:
        "Chame a ferramenta work_report duas vezes seguidas, com exatamente estes argumentos nas duas chamadas: " +
        `summary="Relatório de exemplo", headSha="${"a".repeat(40)}", changedFiles=[], notDone=[]. ` +
        "Não mude nenhum valor e não pare depois da primeira chamada.",
      agent: {
        model: "haiku",
        states: ["InProgress"],
        maxBudgetUsd: 0.05,
        maxTurns: 6,
        timeoutMs: 120000,
        tools: [],
        allowedTools: ["mcp__friday__work_report"],
        bashAllow: [],
        promptFile: "prompt.md",
        outputKind: null,
      },
      friday: {
        runId: "live-93",
        agent: { states: ["InProgress"], mcp_tools: ["work_report"] },
        getIssueState: () => "InProgress",
      },
    });
    // The results ride in the compared object so a failure shows what the tool really answered.
    expect({ denied: secondCallDenied(texts), results: texts }).toMatchObject({ denied: true });
  });
});
