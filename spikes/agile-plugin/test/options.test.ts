import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEnv } from "../src/env.ts";
import { buildPluginOptions, buildPrompt } from "../src/options.ts";
import { RUN_MAX_BUDGET_USD, RUN_MAX_TURNS } from "../src/presets.ts";

const base = { cwd: "/p", pluginPath: "/plug", maxTurns: 3, maxBudgetUsd: 0.5, env: {} };
const ctx = { signal: new AbortController().signal, toolUseID: "t" };

describe("buildPluginOptions", () => {
  it("builds plugin options", () => {
    const options = buildPluginOptions(base);
    expect(options.plugins).toEqual([{ type: "local", path: "/plug" }]);
    expect(options.cwd).toBe("/p");
    expect(options.maxTurns).toBe(3);
    expect(options.maxBudgetUsd).toBe(0.5);
    expect(options.env).toEqual({});
    expect(options.settingSources).toEqual([]);
    expect(options.permissionMode).toBe("default");
    expect(Object.hasOwn(options, "allowedTools")).toBe(false);
  });

  it("denies and records canUseTool calls", async () => {
    const calls: unknown[] = [];
    const options = buildPluginOptions({ ...base, recordCanUse: (c) => calls.push(c) });
    const result = await options.canUseTool("AskUserQuestion", { questions: [] }, ctx);
    expect(result).toEqual({ behavior: "deny", message: "canUseTool nega neste spike" });
    expect(calls).toEqual([{ toolName: "AskUserQuestion", input: { questions: [] } }]);
  });

  it("rejects invalid input", () => {
    expect(() => buildPluginOptions({ ...base, pluginPath: "" })).toThrow("plugin ausente");
    expect(() => buildPluginOptions({ ...base, maxTurns: 0 })).toThrow(
      "maxTurns deve ser inteiro >= 1",
    );
    expect(() => buildPluginOptions({ ...base, maxBudgetUsd: 0 })).toThrow(
      "maxBudgetUsd deve ser > 0",
    );
  });

  it("builds the prompt and the clean env", () => {
    expect(buildPrompt("--x")).toBe("/agile:autopilot --x");
    expect(
      buildEnv({ ANTHROPIC_API_KEY: "a", PATH: "b", GH_TOKEN: "d", SystemRoot: "s" }, ["SystemRoot"]),
    ).toStrictEqual({ ANTHROPIC_API_KEY: "a", PATH: "b", SystemRoot: "s" });
  });

  it("run uses the owner limits", () => {
    expect(RUN_MAX_TURNS).toBe(10);
    expect(RUN_MAX_BUDGET_USD).toBe(0.5);
    const source = readFileSync(resolve(import.meta.dirname, "../run.ts"), "utf8");
    expect(source).toContain("RUN_MAX_TURNS");
    expect(source).toContain("RUN_MAX_BUDGET_USD");
    expect(source).toContain("runPluginSpike");
  });
});
