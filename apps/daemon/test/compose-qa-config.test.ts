import { toAgentRunOptions, type AgentRunOptions } from "@friday/application";
import { describe, expect, it } from "vitest";
import { composeDaemon } from "../src/index.ts";
import { setup, validAgent } from "./compose-qa-helpers.ts";

describe("QA agent config at startup", () => {
  const real = toAgentRunOptions({
    role: "qa",
    states: ["QA"],
    model: "sonnet",
    max_budget_usd: 1.5,
    max_turns: 40,
    timeout_s: 1800,
    tools: ["Read", "Glob", "Grep", "Bash"],
    mcp_tools: ["qa_report", "issue_comment"],
    bash_allow: ["pnpm test", "git diff origin/develop...HEAD"],
    output: "qaReport",
    prompt_file: "prompts/qa.md",
  } as Parameters<typeof toAgentRunOptions>[0]);
  const bad = (over: Partial<AgentRunOptions>) => ({ ...validAgent, ...over });
  const cases: [string, AgentRunOptions][] = [
    ["outputKind", bad({ outputKind: "verdict" as never })],
    ["states", bad({ states: ["QA", "Verify"] as never })],
    ["maxBudgetUsd", bad({ maxBudgetUsd: 0 })],
    ...[";", "&", "|", "<", ">", "`", "$(", "\n", "*"].map(
      (c) =>
        [`bashAllow ${JSON.stringify(c)}`, bad({ bashAllow: [`git log ${c} x`] })] as [
          string,
          AgentRunOptions,
        ],
    ),
    ["absolute promptFile", bad({ promptFile: "/etc/qa.md" })],
    ["promptFile with ..", bad({ promptFile: "../qa.md" })],
    ["tools", bad({ tools: ["Read", "Write"] as never })],
    ["allowedTools", bad({ allowedTools: ["mcp__friday__merge"] })],
  ];

  it.each(cases)("rejects an invalid QA agent config: %s", async (_name, agent) => {
    const t = setup({ agent });
    await expect(composeDaemon(t.opts)).rejects.toThrow("A ficha do QA é inválida.");
  });

  it("accepts a valid QA agent config", async () => {
    for (const agent of [validAgent, real]) {
      const t = setup({ agent });
      const daemon = await composeDaemon(t.opts);
      daemon.release();
    }
  });
});
