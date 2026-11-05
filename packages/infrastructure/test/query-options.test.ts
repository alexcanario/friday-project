import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
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

  it("canUseTool denies and records", async () => {
    const denied: ToolDenied[] = [];
    const { options } = buildFor(request(null), denied);
    const out = await options.canUseTool!(
      "Read",
      {},
      {
        toolUseID: "t2",
        requestId: "r",
        signal: new AbortController().signal,
      },
    );
    expect(out).toEqual({
      behavior: "deny",
      message: "Ferramenta Read negada pela política de permissões.",
    });
    expect(denied).toEqual([{ toolName: "Read", toolUseId: "t2" }]);
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
    expect(typeof options.canUseTool).toBe("function");
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
