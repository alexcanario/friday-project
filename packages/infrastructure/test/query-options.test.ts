import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { contractJsonSchema } from "@friday/contracts";
import type { AgentRunOptions, AgentRunRequest, ToolDenied } from "@friday/application";
import { describe, expect, it } from "vitest";
import {
  buildQueryOptions,
  buildToolPolicy,
  HOOK_TIMEOUT_MS,
  HOOK_TIMEOUT_SECONDS,
} from "../src/index.ts";
import { qa, specialist } from "./policy-helpers.ts";

const request = (outputKind: AgentRunRequest["agent"]["outputKind"]): AgentRunRequest => ({
  cwd: "/work",
  prompt: "p",
  configRoot: "/cfg",
  agent: {
    model: "sonnet",
    states: ["InProgress"],
    maxBudgetUsd: 0.5,
    maxTurns: 7,
    timeoutMs: 1000,
    tools: ["Read"],
    allowedTools: ["mcp__friday__qa_report"],
    bashAllow: [],
    promptFile: "prompt.md",
    outputKind,
  },
});
const buildFor = (req: AgentRunRequest, denied: ToolDenied[] = []) => {
  const abortController = new AbortController();
  const built = buildToolPolicy(req.agent, req.cwd);
  if (!built.ok) throw new Error("policy");
  const options = buildQueryOptions({
    request: req,
    env: { PATH: "b" },
    systemPromptAppend: "texto",
    abortController,
    policy: built.policy,
    sink: { record: (d) => denied.push(d) },
  });
  return { options, abortController };
};
const build = (outputKind: AgentRunRequest["agent"]["outputKind"]) => buildFor(request(outputKind));
const requestFor = (agent: AgentRunOptions, cwd = "/work"): AgentRunRequest => ({
  cwd,
  prompt: "p",
  configRoot: "/cfg",
  agent,
});

describe("buildQueryOptions", () => {
  it("builds the exact sdk options", () => {
    const { options, abortController } = build(null);
    expect(options).toMatchObject({
      cwd: "/work",
      env: { PATH: "b" },
      model: "sonnet",
      tools: ["Read"],
      allowedTools: ["mcp__friday__qa_report", "Read"],
      permissionMode: "dontAsk",
      settingSources: [],
      strictMcpConfig: true,
      maxTurns: 7,
      maxBudgetUsd: 0.5,
      systemPrompt: { type: "preset", preset: "claude_code", append: "texto" },
      persistSession: false,
      abortController,
    });
    expect("outputFormat" in options).toBe(false);
    for (const key of ["plugins", "mcpServers"]) {
      expect(key in options).toBe(false);
    }
    expect(build("qaReport").options.outputFormat).toEqual({
      type: "json_schema",
      schema: contractJsonSchema("qaReport"),
    });
  });

  it("hook from buildQueryOptions denies Bash outside bashAllow and allows inside", async () => {
    const denied: ToolDenied[] = [];
    const { options } = buildFor(
      requestFor(specialist({ tools: ["Read", "Bash"], bashAllow: ["pnpm test*"] })),
      denied,
    );
    const hook = options.hooks!.PreToolUse![0]!.hooks[0]!;
    const call = (command: string) =>
      hook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command },
          tool_use_id: "t1",
        } as unknown as PreToolUseHookInput,
        "t1",
        { signal: new AbortController().signal },
      );
    expect(await call("rm -rf x")).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Ferramenta Bash negada pela política de permissões.",
      },
    });
    expect(denied).toEqual([{ toolName: "Bash", toolUseId: "t1" }]);
    expect(await call("pnpm test")).toEqual({});
    expect(denied).toHaveLength(1);
  });

  it("dontAsk mode without canUseTool", () => {
    const { options } = build(null);
    expect(options.permissionMode).toBe("dontAsk");
    expect(options.canUseTool).toBeUndefined();
    expect("canUseTool" in options).toBe(false);
  });

  it("allowedTools keeps mcp entries and never Write or Edit for QA", () => {
    const agent = qa({ allowedTools: ["mcp__friday__qa_report", "mcp__friday__x"], bashAllow: [] });
    const { options } = buildFor(requestFor(agent));
    for (const entry of agent.allowedTools) expect(options.allowedTools).toContain(entry);
    expect(options.allowedTools).not.toContain("Write");
    expect(options.allowedTools).not.toContain("Edit");
    expect(options.allowedTools).not.toContain("Bash");
  });

  it("builds allowedTools, hook and settings without reading the worktree", () => {
    const base: Partial<AgentRunOptions> = {
      tools: ["Read", "Bash"],
      allowedTools: ["mcp__friday__work_report"],
      bashAllow: ["pnpm test*"],
    };
    const { options } = buildFor(requestFor(specialist(base)));
    expect(options.allowedTools).toEqual(["mcp__friday__work_report", "Read", "Bash"]);
    expect(options.hooks?.PreToolUse).toHaveLength(1);
    const entry = options.hooks!.PreToolUse![0]!;
    expect("matcher" in entry).toBe(false);
    expect(entry).toMatchObject({ onFailure: "block", timeout: 5 });
    expect(entry.hooks).toHaveLength(1);
    expect(HOOK_TIMEOUT_SECONDS).toBe(5);
    expect(HOOK_TIMEOUT_MS).toBe(4500);
    expect(options.canUseTool).toBeUndefined();
    expect(options).toMatchObject({ permissionMode: "dontAsk", settingSources: [] });
    expect("mcpServers" in options || "plugins" in options).toBe(false);

    const noBash = buildFor(requestFor(specialist({ ...base, bashAllow: [] }))).options;
    expect(noBash.allowedTools).toEqual(["mcp__friday__work_report", "Read"]);

    const review = buildFor(requestFor(qa())).options;
    for (const list of [review.tools as string[], review.allowedTools!]) {
      expect(list).not.toContain("Write");
      expect(list).not.toContain("Edit");
    }

    const plain = mkdtempSync(join(tmpdir(), "friday-qo-a-"));
    const loaded = mkdtempSync(join(tmpdir(), "friday-qo-b-"));
    mkdirSync(join(loaded, ".claude"));
    mkdirSync(join(loaded, ".friday"));
    writeFileSync(join(loaded, ".claude/settings.json"), '{"permissions":{"allow":["Write"]}}');
    writeFileSync(join(loaded, ".friday/factory.yaml"), "allowedTools: [Write]\n");
    const a = buildFor(requestFor(specialist(base), plain)).options;
    const b = buildFor(requestFor(specialist(base), loaded)).options;
    for (const key of ["allowedTools", "tools", "permissionMode", "settingSources"] as const) {
      expect(b[key]).toEqual(a[key]);
    }
  });

  it("passes mcpServers only when given", () => {
    const req = request(null);
    const built = buildToolPolicy(req.agent, req.cwd);
    if (!built.ok) throw new Error("policy");
    const base = {
      request: req,
      env: {},
      systemPromptAppend: "t",
      abortController: new AbortController(),
      policy: built.policy,
      sink: { record: () => undefined },
    };
    const server = { type: "sdk", name: "friday" } as unknown as NonNullable<
      Options["mcpServers"]
    >[string];
    const withServer = buildQueryOptions({ ...base, mcpServers: { friday: server } });
    expect(withServer.mcpServers).toEqual({ friday: server });
    expect(withServer.strictMcpConfig).toBe(true);
    expect("mcpServers" in buildQueryOptions(base)).toBe(false);
  });
});
