import type { RunFinished } from "@friday/contracts";
import { describe, expect, it } from "vitest";
import { FakeAgentRuntime, type AgentRunRequest } from "../src/index.ts";

const result = (costUsd: number): RunFinished => ({
  status: "succeeded",
  subtype: "success",
  model: null,
  costUsd,
  tokens: null,
  numTurns: null,
  durationMs: null,
  output: null,
  violations: [],
});
const request = (prompt: string): AgentRunRequest => ({
  cwd: "/w",
  prompt,
  configRoot: "/c",
  agent: {
    model: "sonnet",
    states: ["InProgress"],
    maxBudgetUsd: 1,
    maxTurns: 1,
    timeoutMs: 1,
    tools: [],
    allowedTools: [],
    bashAllow: [],
    promptFile: "p.md",
    outputKind: null,
  },
});

describe("FakeAgentRuntime", () => {
  it("returns results in order and records requests", async () => {
    const fake = new FakeAgentRuntime([result(1), result(2)]);
    expect(await fake.run(request("a"))).toEqual(result(1));
    expect(await fake.run(request("b"))).toEqual(result(2));
    expect(fake.requests.map((r) => r.prompt)).toEqual(["a", "b"]);
    await expect(fake.run(request("c"))).rejects.toThrow("FakeAgentRuntime sem resultado");
  });
});
