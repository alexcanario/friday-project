import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { ToolDenied } from "@friday/application";
import { describe, expect, it } from "vitest";
import { buildToolPolicy, ClaudeAgentSdkRuntime, decideToolCall } from "../src/index.ts";
import { dedupeDenials } from "../src/denial-dedup.ts";
import { fakeQuery, init, makeRequest, PROMPT, result, type QueryFn } from "./runtime-helpers.ts";
import { agentFor } from "./policy-helpers.ts";

describe("configRoot guard resolves once", () => {
  it("reads the same resolved path the guard checked", async () => {
    const base = mkdtempSync(join(tmpdir(), "friday-once-"));
    const cwd = join(base, "wt");
    mkdirSync(join(cwd, "cfg"), { recursive: true });
    writeFileSync(join(cwd, "cfg", "prompt.md"), "ENVENENADO");
    mkdirSync(join(base, "external", "sub"), { recursive: true });
    mkdirSync(join(base, "external", "cfg"), { recursive: true });
    writeFileSync(join(base, "external", "cfg", "prompt.md"), PROMPT);
    symlinkSync(join(base, "external", "sub"), join(cwd, "link"));
    let options: Options | undefined;
    const query: QueryFn = (p) => {
      options = p.options;
      return fakeQuery([init(), result()])(p);
    };
    const request = { ...makeRequest(), cwd, configRoot: `${cwd}/link/../cfg` };
    const out = await new ClaudeAgentSdkRuntime({ query, env: {} }).run(request);
    expect(out.status).toBe("succeeded");
    expect((options!.systemPrompt as { append: string }).append).toBe(PROMPT);
  });
});

describe("permission denials from the result", () => {
  it("isolates a throwing sink per denial", async () => {
    const denials = [
      { tool_name: "Bash", tool_use_id: "t1", tool_input: {} },
      { tool_name: "Write", tool_use_id: "t2", tool_input: {} },
    ];
    const seen: ToolDenied[] = [];
    let first = true;
    const sink = {
      record: (d: ToolDenied) => {
        if (first) {
          first = false;
          throw new Error("sink quebrado");
        }
        seen.push(d);
      },
    };
    const out = await new ClaudeAgentSdkRuntime({
      query: fakeQuery([init(), result({ permission_denials: denials })]),
      env: {},
      sink,
    }).run(makeRequest());
    expect(out.status).toBe("succeeded");
    expect(seen).toEqual([{ toolName: "Write", toolUseId: "t2" }]);
  });
});

describe("dedupeDenials", () => {
  it("marks an id as seen only after the sink returned", () => {
    const seen: string[] = [];
    let fail = true;
    const dedup = dedupeDenials({
      record: (d) => {
        if (fail) throw new Error("falha");
        seen.push(d.toolUseId);
      },
    });
    const denial = { toolName: "Bash", toolUseId: "t1" };
    expect(() => dedup.record(denial)).toThrow();
    fail = false;
    dedup.record(denial);
    dedup.record(denial);
    expect(seen).toEqual(["t1"]);
  });
});

describe("StructuredOutput in the hook", () => {
  const decide = (outputKind: "qaReport" | null) => {
    const r = buildToolPolicy(agentFor({ outputKind }), "/work/wt/17", { realpath: (p) => p });
    if (!r.ok) throw new Error("policy");
    return decideToolCall(r.policy, { toolName: "StructuredOutput", toolInput: { a: 1 } }).allow;
  };
  it("allows it only when the agent has an outputKind", () => {
    expect(decide("qaReport")).toBe(true);
    expect(decide(null)).toBe(false);
  });
});
