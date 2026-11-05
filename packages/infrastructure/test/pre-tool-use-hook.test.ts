import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import type { ToolDenied } from "@friday/application";
import { describe, expect, it } from "vitest";
import { buildPreToolUseHook, buildToolPolicy, type ToolDecision } from "../src/index.ts";
import { specialist } from "./policy-helpers.ts";

const built = buildToolPolicy(specialist(), "/work/wt/17");
if (!built.ok) throw new Error("policy");
const policy = built.policy;

const input = (toolName: string, toolInput: unknown, id = "t1") =>
  ({
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: id,
  }) as unknown as PreToolUseHookInput;
const signal = { signal: new AbortController().signal };
const denial = (reason: string) => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: reason,
  },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(over: { timeoutMs?: number; decide?: () => Promise<ToolDecision> } = {}) {
  const recorded: ToolDenied[] = [];
  const hook = buildPreToolUseHook({
    policy,
    sink: { record: (d) => recorded.push(d) },
    timeoutMs: over.timeoutMs ?? 1000,
    ...(over.decide ? { decide: over.decide } : {}),
  });
  return { hook, recorded };
}

describe("buildPreToolUseHook", () => {
  it("allows with empty output and denies with a recorded reason", async () => {
    const { hook, recorded } = setup();
    expect(await hook(input("Read", { file_path: "/work/wt/17/a.ts" }), "t1", signal)).toEqual({});
    expect(recorded).toEqual([]);
    const out = await hook(input("Write", { file_path: "/etc/x", content: "" }), "t1", signal);
    expect(out).toEqual(denial("Ferramenta Write negada pela política de permissões."));
    expect(recorded).toEqual([{ toolName: "Write", toolUseId: "t1" }]);
  });

  it("blocks the call on hook timeout or error", async () => {
    const slow = setup({
      timeoutMs: 10,
      decide: async () => {
        await sleep(200);
        return { allow: true };
      },
    });
    expect(await slow.hook(input("Read", {}), "t1", signal)).toEqual(
      denial("Tempo esgotado na política de permissões."),
    );
    expect(slow.recorded).toEqual([{ toolName: "Read", toolUseId: "t1" }]);

    const boom = setup({
      decide: () => {
        throw new Error("boom");
      },
    });
    expect(await boom.hook(input("Read", {}), "t1", signal)).toEqual(
      denial("Erro na política de permissões."),
    );
    expect(boom.recorded).toHaveLength(1);

    const fast = setup({ timeoutMs: 10, decide: async () => ({ allow: true }) });
    expect(await fast.hook(input("Read", {}), "t1", signal)).toEqual({});

    const hook = buildPreToolUseHook({
      policy,
      sink: {
        record: () => {
          throw new Error("sink");
        },
      },
      timeoutMs: 1000,
    });
    expect(await hook(input("Write", { file_path: "/etc/x" }), "t1", signal)).toEqual(
      denial("Ferramenta Write negada pela política de permissões."),
    );
  });
});
