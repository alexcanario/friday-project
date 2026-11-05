import { describe, expect, it } from "vitest";
import { denyWrite } from "../src/hooks.ts";

const input = (tool_name: string) => ({ hook_event_name: "PreToolUse", tool_name, tool_input: {} }) as any;
const ctx = { signal: new AbortController().signal };

describe("denyWrite", () => {
  it("denies Write and ignores other tools", async () => {
    expect(await denyWrite(input("Write"), "t1", ctx)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Write é proibido neste spike",
      },
    });
    expect(await denyWrite(input("Read"), "t2", ctx)).toEqual({});
  });
});
