import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runPluginSpike } from "../src/runner.ts";

const messages = [
  { type: "system", subtype: "init", tools: ["AskUserQuestion"] },
  {
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "t1", name: "AskUserQuestion", input: {} }] },
  },
  { type: "result", subtype: "success", total_cost_usd: 0.01, num_turns: 1 },
];

function fakeQuery(callCanUse: boolean, seen: { prompt: string; options: any }[]) {
  return async function* (params: { prompt: string; options: any }) {
    seen.push(params);
    for (const message of messages) yield message;
    if (callCanUse) {
      await params.options.canUseTool(
        "Bash",
        { command: "ls" },
        { signal: new AbortController().signal, toolUseID: "t" },
      );
    }
  };
}

const lines = (path: string) => readFileSync(path, "utf8").trim().split("\n");
const optionsInput = { cwd: "/p", pluginPath: "/plug", maxTurns: 3, maxBudgetUsd: 0.5, env: {} };

describe("runPluginSpike", () => {
  it("passes plugins to query and writes the logs", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "plugin-out-"));
    const seen: { prompt: string; options: any }[] = [];
    await runPluginSpike({ query: fakeQuery(true, seen), prompt: "/agile:autopilot x", optionsInput, outDir });
    expect(seen[0].prompt).toBe("/agile:autopilot x");
    expect(seen[0].options.plugins).toEqual([{ type: "local", path: "/plug" }]);
    const file = join(outDir, "plugin.messages.jsonl");
    expect(lines(file).map((l) => JSON.parse(l))).toEqual(messages);
    expect(JSON.parse(readFileSync(join(outDir, "plugin.can-use-tool.json"), "utf8"))).toEqual([
      { toolName: "Bash", input: { command: "ls" } },
    ]);

    await runPluginSpike({ query: fakeQuery(false, seen), prompt: "p", optionsInput, outDir });
    expect(lines(file)).toHaveLength(3);
    expect(JSON.parse(readFileSync(join(outDir, "plugin.can-use-tool.json"), "utf8"))).toEqual([]);
  });
});
