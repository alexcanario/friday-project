import type { FactoryConfig } from "@friday/contracts";
import type { WorkflowInput } from "@friday/domain";
import { describe, expect, it } from "vitest";
import { classifyRisk, decideGates, type GateInput } from "../src/index.ts";

const base: GateInput = {
  risk: "low",
  mergeMode: "auto",
  changedPaths: ["src/a.ts"],
  screenPaths: [],
  issueGates: [],
};

describe("decideGates", () => {
  it("low risk with auto merge and no gate merges without a human", () => {
    expect(decideGates(base)).toEqual({
      risk: "low",
      autoMerge: true,
      humanReview: false,
      gates: [],
    });
  });

  it("manual mode, high and unclassified go to a human", () => {
    for (const input of [
      { ...base, mergeMode: "manual" as const },
      { ...base, risk: "high" as const },
      { ...base, risk: "unclassified" as const },
    ]) {
      const d = decideGates(input);
      expect(d.autoMerge).toBe(false);
      expect(d.humanReview).toBe(true);
    }
  });

  it("workflow paths add gate:security", () => {
    for (const p of [".github/workflows/ci.yml", ".claude/agents/judge.md"]) {
      expect(decideGates({ ...base, changedPaths: [p] })).toMatchObject({
        gates: ["gate:security"],
        autoMerge: false,
        humanReview: true,
      });
    }
    expect(decideGates({ ...base, changedPaths: ["docs/readme.md"] })).toMatchObject({
      gates: [],
      autoMerge: true,
      humanReview: false,
    });
  });

  it("screen paths add gate:screen", () => {
    const screenPaths = ["apps/panel/**"];
    expect(decideGates({ ...base, screenPaths, changedPaths: ["apps/panel/index.html"] }).gates).toEqual([
      "gate:screen",
    ]);
    expect(decideGates({ ...base, screenPaths, changedPaths: ["docs/readme.md"] }).gates).toEqual([]);
  });

  it("merges issue gates, deduplicated and sorted", () => {
    const d = decideGates({
      ...base,
      issueGates: ["gate:screen", "gate:business"],
      screenPaths: ["apps/panel/**"],
      changedPaths: [".github/workflows/ci.yml", "apps/panel/x.html"],
    });
    expect(d.gates).toEqual(["gate:business", "gate:screen", "gate:security"]);
    expect(d.humanReview).toBe(true);
  });

  it("result feeds RiskAssessed", () => {
    const config: FactoryConfig["risk"] = {
      rules: ["migrations", "infra", "ci", "dependencies", "secrets", "agent_config", "size"],
      max_changed_lines: 2000,
      max_changed_files: 50,
    };
    const verdict = classifyRisk(
      { files: [{ path: "src/a.ts", changedLines: 1, hasPatch: true }], diffBytes: 100 },
      config,
    );
    const decision = decideGates({
      risk: verdict.risk,
      mergeMode: "manual",
      changedPaths: ["src/a.ts"],
      screenPaths: [],
      issueGates: [],
    });
    const input: Extract<WorkflowInput, { type: "RiskAssessed" }> = {
      type: "RiskAssessed",
      risk: decision.risk,
      autoMerge: decision.autoMerge,
    };
    expect(input).toEqual({ type: "RiskAssessed", risk: "unclassified", autoMerge: false });
  });
});
