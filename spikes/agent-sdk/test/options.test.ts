import { describe, expect, it } from "vitest";
import { z } from "zod";
import { denyWrite } from "../src/hooks.ts";
import { buildOptions } from "../src/options.ts";
import { resultSchema } from "../src/schema.ts";

const base = { cwd: "/w", maxTurns: 3, maxBudgetUsd: 0.5, env: {} };

describe("buildOptions", () => {
  it("builds the locked-down options", () => {
    const o = buildOptions(base) as any;
    expect(o.tools).toEqual(["Read", "Glob", "Grep"]);
    expect(o.allowedTools).toEqual(["Read", "Glob", "Grep", "mcp__spike__record"]);
    expect(o.permissionMode).toBe("dontAsk");
    expect(o.settingSources).toEqual(["project"]);
    expect(o.strictMcpConfig).toBe(true);
    expect(o.cwd).toBe("/w");
    expect(o.maxTurns).toBe(3);
    expect(o.maxBudgetUsd).toBe(0.5);
    expect(o.env).toEqual({});
    expect(o.outputFormat.type).toBe("json_schema");
    expect(o.outputFormat.schema).toEqual(z.toJSONSchema(resultSchema, { target: "draft-7" }));
    expect(o.hooks.PreToolUse[0].matcher).toBe("Write");
    expect(o.hooks.PreToolUse[0].hooks[0]).toBe(denyWrite);
    expect(Object.keys(o.mcpServers)).toContain("spike");
  });

  it("exposes Write only on request", () => {
    const o = buildOptions({ ...base, exposeWrite: true }) as any;
    expect(o.tools).toEqual(["Read", "Glob", "Grep", "Write"]);
    expect(o.allowedTools).toEqual(["Read", "Glob", "Grep", "mcp__spike__record"]);
    expect((buildOptions({ ...base, withHook: false }) as any).hooks).toBeUndefined();
  });

  it("denies and records canUseTool calls", async () => {
    const seen: unknown[] = [];
    const o = buildOptions({ ...base, recordCanUse: (call) => seen.push(call) }) as any;
    const result = await o.canUseTool(
      "Write",
      { file_path: "a" },
      { signal: new AbortController().signal, toolUseID: "t" },
    );
    expect(result).toEqual({ behavior: "deny", message: "canUseTool nega neste spike" });
    expect(seen).toEqual([{ toolName: "Write", input: { file_path: "a" } }]);
  });

  it("rejects invalid ceilings", () => {
    expect(() => buildOptions({ ...base, maxTurns: 0 })).toThrow("maxTurns deve ser inteiro >= 1");
    expect(() => buildOptions({ ...base, maxBudgetUsd: 0 })).toThrow("maxBudgetUsd deve ser > 0");
  });
});
