import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSpike } from "../src/runner.ts";
import { makeRepo, makeTmp } from "./helpers.ts";

const messages = [
  { type: "system", subtype: "init", tools: ["Read"] },
  { type: "assistant", message: { content: [] } },
  { type: "result", subtype: "success", total_cost_usd: 0.01, num_turns: 1 },
];

function fakeQuery(callCanUse: boolean, seen: any[]) {
  return async function* (params: { prompt: string; options: any }) {
    seen.push(params.options);
    for (const message of messages) yield message;
    if (callCanUse) {
      await params.options.canUseTool(
        "Write",
        { file_path: "x" },
        { signal: new AbortController().signal, toolUseID: "t" },
      );
    }
  };
}

const lines = (path: string) => readFileSync(path, "utf8").trim().split("\n");

describe("runSpike", () => {
  it("runs query in the worktree and writes one log per mode", async () => {
    const repo = makeRepo();
    const outDir = makeTmp("spike-out-");
    const seen: any[] = [];
    await runSpike({ repo, mode: "normal", outDir, env: {}, query: fakeQuery(true, seen) as any });
    const cwd = seen[0].cwd as string;
    expect(existsSync(join(cwd, "hello.txt"))).toBe(true);
    expect(cwd).not.toBe(repo);
    const file = join(outDir, "normal.messages.jsonl");
    expect(lines(file).map((l) => JSON.parse(l))).toEqual(messages);
    expect(JSON.parse(readFileSync(join(outDir, "normal.can-use-tool.json"), "utf8"))).toEqual([
      { toolName: "Write", input: { file_path: "x" } },
    ]);

    await runSpike({ repo, mode: "budget", outDir, env: {}, query: fakeQuery(false, seen) as any });
    expect(lines(join(outDir, "budget.messages.jsonl"))).toHaveLength(3);
    expect(JSON.parse(readFileSync(join(outDir, "budget.can-use-tool.json"), "utf8"))).toEqual([]);
    expect(lines(file)).toHaveLength(3);

    await runSpike({ repo, mode: "normal", outDir, env: {}, query: fakeQuery(false, seen) as any });
    expect(lines(file)).toHaveLength(3);
    expect(JSON.parse(readFileSync(join(outDir, "normal.can-use-tool.json"), "utf8"))).toEqual([]);
    expect(seen[2].cwd).not.toBe(seen[0].cwd);
  });

  it("keeps the logs and rethrows when query throws after an error result", async () => {
    const repo = makeRepo();
    const outDir = makeTmp("spike-out-");
    const errorResult = { type: "result", subtype: "error_max_budget_usd", is_error: true };
    const throwingQuery = async function* () {
      yield errorResult;
      throw new Error("Claude Code returned an error result");
    };
    await expect(
      runSpike({ repo, mode: "budget", outDir, env: {}, query: throwingQuery as any }),
    ).rejects.toThrow("error result");
    const logged = lines(join(outDir, "budget.messages.jsonl")).map((l) => JSON.parse(l));
    expect(logged).toEqual([errorResult]);
    expect(JSON.parse(readFileSync(join(outDir, "budget.can-use-tool.json"), "utf8"))).toEqual([]);
  });
});
