import { describe, expect, it } from "vitest";
import { buildTriageRequest, type TriageAgentConfig } from "../src/index.ts";
import { assertTriageAgentConfig } from "../src/triage-request.ts";
import { AGENT_CONFIG, FLOW, ISSUE } from "./triage-fakes.ts";

const build = (agentConfig: TriageAgentConfig) =>
  buildTriageRequest({ issue: ISSUE, flow: FLOW, agentConfig, cwd: "/r", configRoot: "/r" });

describe("buildTriageRequest", () => {
  it("builds the triage request without tools or friday", () => {
    const request = build(AGENT_CONFIG);
    expect(request).toEqual({
      cwd: "/r",
      configRoot: "/r",
      prompt: "Issue #10: API de fotos\n\nCriar endpoint",
      agent: {
        model: "haiku",
        states: [],
        maxBudgetUsd: 0.5,
        maxTurns: 3,
        timeoutMs: 120000,
        tools: [],
        allowedTools: [],
        bashAllow: [],
        promptFile: "prompts/triage.md",
        outputKind: "triage",
      },
    });
    expect("friday" in request).toBe(false);
  });

  it("accepts a valid triage agent config", () => {
    expect(() => assertTriageAgentConfig(AGENT_CONFIG)).not.toThrow();
  });

  it("rejects an invalid triage agent config", () => {
    const bad: Partial<TriageAgentConfig>[] = [
      { maxTurns: 0 },
      { maxTurns: 1.5 },
      { timeoutMs: -1 },
      { promptFile: "" },
      { promptFile: "/abs.md" },
      { promptFile: "../x.md" },
    ];
    for (const patch of bad) {
      expect(() => assertTriageAgentConfig({ ...AGENT_CONFIG, ...patch })).toThrow(
        "A ficha da triagem é inválida.",
      );
      expect(() => build({ ...AGENT_CONFIG, ...patch })).toThrow("A ficha da triagem é inválida.");
    }
    expect(() => build(AGENT_CONFIG)).not.toThrow();
  });
});
