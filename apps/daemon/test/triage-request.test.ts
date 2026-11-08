import { describe, expect, it } from "vitest";
import { buildTriageRequest, type TriageFicha } from "../src/index.ts";
import { FICHA, FLOW, ISSUE } from "./triage-fakes.ts";

const build = (ficha: TriageFicha) =>
  buildTriageRequest({ issue: ISSUE, flow: FLOW, ficha, cwd: "/r", configRoot: "/r" });

describe("buildTriageRequest", () => {
  it("builds the triage request without tools or friday", () => {
    const request = build(FICHA);
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

  it("rejects an invalid triage ficha", () => {
    const bad: Partial<TriageFicha>[] = [
      { maxTurns: 0 },
      { maxTurns: 1.5 },
      { timeoutMs: -1 },
      { promptFile: "" },
      { promptFile: "/etc/passwd" },
      { promptFile: "../x.md" },
    ];
    for (const patch of bad) {
      expect(() => build({ ...FICHA, ...patch })).toThrow("A ficha da triagem é inválida.");
    }
    expect(() => build(FICHA)).not.toThrow();
  });
});
