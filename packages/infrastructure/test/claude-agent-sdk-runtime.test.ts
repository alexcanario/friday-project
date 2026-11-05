import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AgentRunOptions, ToolDenied } from "@friday/application";
import { validateContract } from "@friday/contracts";
import {
  buildQueryOptions,
  buildRunEnv,
  buildToolPolicy,
  ClaudeAgentSdkRuntime,
} from "../src/index.ts";
import { fakeQuery, init, makeRequest, PROMPT, result, type QueryFn } from "./runtime-helpers.ts";

const qa = {
  verdict: "pass",
  criteria: [{ index: 1, result: "pass", how: "pnpm test exit 0", screenshots: [] }],
  notChecked: [],
};

describe("ClaudeAgentSdkRuntime", () => {
  it("reads the prompt file and calls query", async () => {
    const request = makeRequest();
    const calls: Array<{ prompt: string; options: Options }> = [];
    const query: QueryFn = (params) => {
      calls.push(params);
      return fakeQuery([init(), result()])(params);
    };
    const env = { ANTHROPIC_API_KEY: "a", PATH: "b", GH_TOKEN: "d" };
    await new ClaudeAgentSdkRuntime({ query, env }).run(request);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.prompt).toBe("faça");
    expect(call.options.env).toEqual({ ANTHROPIC_API_KEY: "a", PATH: "b" });
    expect(call.options.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: readFileSync(join(request.configRoot, "prompt.md"), "utf8"),
    });
    expect(PROMPT).toBe((call.options.systemPrompt as { append: string }).append);
    const built = buildToolPolicy(request.agent, request.cwd);
    if (!built.ok) throw new Error("policy");
    const expected = buildQueryOptions({
      request,
      env: buildRunEnv(env),
      systemPromptAppend: PROMPT,
      abortController: call.options.abortController!,
      policy: built.policy,
      sink: { record: () => undefined },
    });
    expect(Object.keys(call.options).sort()).toEqual(Object.keys(expected).sort());
    expect({ ...call.options, hooks: 0, canUseTool: 0 }).toEqual({
      ...expected,
      hooks: 0,
      canUseTool: 0,
    });

    let called = false;
    const missing = makeRequest({ promptFile: "nope.md" });
    const out = await new ClaudeAgentSdkRuntime({
      query: (p) => {
        called = true;
        return fakeQuery([])(p);
      },
      env,
    }).run(missing);
    expect(out.status).toBe("misconfigured");
    expect(called).toBe(false);
  });

  it("extracts cost, turns and tokens from the result", async () => {
    const rt = new ClaudeAgentSdkRuntime({ query: fakeQuery([init(), result()]), env: {} });
    const out = await rt.run(makeRequest());
    expect(out).toMatchObject({
      status: "succeeded",
      subtype: "success",
      model: "m-init",
      costUsd: 0.5,
      numTurns: 2,
      durationMs: 100,
      tokens: { input: 11, output: 22, cacheRead: 33, cacheCreation: 44 },
      output: null,
      violations: [],
    });
  });

  it("classifies each result", async () => {
    const boom = new Error("boom");
    const cases: Array<[Record<string, unknown>, string, boolean]> = [
      [{ is_error: true }, "failed", true],
      [{ subtype: "error_max_budget_usd", is_error: true }, "budget_exceeded", true],
      [{ subtype: "error_max_turns", is_error: true }, "turns_exceeded", true],
      [{ subtype: "error_max_structured_output_retries", is_error: true }, "invalid_output", true],
      [{ subtype: "error_during_execution", is_error: true }, "failed", true],
      [{ subtype: "something_new", is_error: true }, "failed", true],
      [{ subtype: "success" }, "succeeded", false],
    ];
    for (const [over, status, throws] of cases) {
      const query = fakeQuery([init(), result(over)], throws ? boom : undefined);
      const out = await new ClaudeAgentSdkRuntime({ query, env: {} }).run(makeRequest());
      expect(out.status, JSON.stringify(over)).toBe(status);
      expect(out.subtype).toBe(over.subtype ?? "success");
    }
    const noInit = fakeQuery([result()]);
    const out = await new ClaudeAgentSdkRuntime({ query: noInit, env: {} }).run(makeRequest());
    expect(out.status).toBe("misconfigured");
    const late = fakeQuery([result(), init()]);
    const lateOut = await new ClaudeAgentSdkRuntime({ query: late, env: {} }).run(makeRequest());
    expect(lateOut).toMatchObject({ status: "misconfigured", costUsd: 0.5, numTurns: 2 });
  });

  it("validates the structured output", async () => {
    const run = (extra: Record<string, unknown>) =>
      new ClaudeAgentSdkRuntime({
        query: fakeQuery([init(), result(extra)]),
        env: {},
      }).run(makeRequest({ outputKind: "qaReport" }));
    const ok = await run({ structured_output: qa });
    expect(ok).toMatchObject({ status: "succeeded", output: qa, violations: [] });
    const bad = await run({ structured_output: { verdict: "pass" } });
    expect(bad.status).toBe("invalid_output");
    expect(bad.output).toBeNull();
    const expectedBad = validateContract("qaReport", { verdict: "pass" });
    if (expectedBad.ok) throw new Error("expected a contract violation");
    expect(bad.violations).toEqual(expectedBad.violations);
    const missing = await run({});
    expect(missing.status).toBe("invalid_output");
    expect(missing.violations).toEqual([
      {
        code: "required_field",
        path: "structured_output",
        message: "Campo obrigatório ausente (structured_output).",
      },
    ]);
  });

  it("aborts on a tool outside the agent file", async () => {
    let signal: AbortSignal | undefined;
    const spy =
      (messages: ReturnType<typeof init>[]): QueryFn =>
      (p) => {
        signal = p.options.abortController?.signal;
        return fakeQuery(messages)(p);
      };
    const okRun = await new ClaudeAgentSdkRuntime({
      query: spy([init(["Read", "StructuredOutput"]), result()]),
      env: {},
    }).run(makeRequest());
    expect(okRun.status).toBe("succeeded");
    expect(signal?.aborted).toBe(false);

    const absent = await new ClaudeAgentSdkRuntime({
      query: spy([init(["StructuredOutput"]), result()]),
      env: {},
    }).run(makeRequest());
    expect(absent.status).toBe("succeeded");
    expect(signal?.aborted).toBe(false);

    const bad = await new ClaudeAgentSdkRuntime({
      query: spy([init(["Read", "Bash"]), result()]),
      env: {},
    }).run(makeRequest());
    expect(signal?.aborted).toBe(true);
    expect(bad).toMatchObject({ status: "misconfigured", model: "m-init" });

    const lateViolation: QueryFn = (p) =>
      (async function* () {
        const abort = p.options.abortController!.signal;
        await new Promise<void>((resolve) => abort.addEventListener("abort", () => resolve()));
        yield init(["Bash"]);
      })();
    const both = await new ClaudeAgentSdkRuntime({ query: lateViolation, env: {} }).run(
      makeRequest({ timeoutMs: 10 }),
    );
    expect(both.status).toBe("misconfigured");
  });

  it("handles timeout and missing result", async () => {
    const waiting: QueryFn = (p) =>
      (async function* () {
        const signal = p.options.abortController!.signal;
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
        yield init();
      })();
    const timeout = await new ClaudeAgentSdkRuntime({ query: waiting, env: {} }).run(
      makeRequest({ timeoutMs: 10 }),
    );
    expect(timeout).toMatchObject({
      status: "timeout",
      costUsd: null,
      tokens: null,
      numTurns: null,
      durationMs: null,
      subtype: null,
    });
    const run = (query: QueryFn) =>
      new ClaudeAgentSdkRuntime({ query, env: {} }).run(makeRequest());
    expect((await run(fakeQuery([init()], new Error("x")))).status).toBe("failed");
    expect((await run(fakeQuery([init()]))).status).toBe("failed");
    const sync: QueryFn = () => {
      throw new Error("sync");
    };
    expect((await run(sync)).status).toBe("failed");

    let signal: AbortSignal | undefined;
    const quick: QueryFn = (p) => {
      signal = p.options.abortController?.signal;
      return fakeQuery([init(), result()])(p);
    };
    await new ClaudeAgentSdkRuntime({ query: quick, env: {} }).run(makeRequest({ timeoutMs: 20 }));
    await new Promise((r) => setTimeout(r, 40));
    expect(signal?.aborted).toBe(false);
  });

  it("refuses a config root inside the worktree and a role-invalid agent file", async () => {
    const base = mkdtempSync(join(tmpdir(), "friday-guard-rt-"));
    const cwd = join(base, "wt");
    mkdirSync(join(cwd, "cfg"), { recursive: true });
    writeFileSync(join(cwd, "cfg", "prompt.md"), PROMPT);
    mkdirSync(join(base, "sibling"));
    writeFileSync(join(base, "sibling", "prompt.md"), PROMPT);
    symlinkSync(cwd, join(base, "link"));
    const agent = makeRequest().agent;
    const attempt = async (configRoot: string, over = agent) => {
      let calls = 0;
      const denied: ToolDenied[] = [];
      const query: QueryFn = (p) => {
        calls += 1;
        return fakeQuery([init(), result()])(p);
      };
      const rt = new ClaudeAgentSdkRuntime({
        query,
        env: {},
        sink: { record: (d) => denied.push(d) },
      });
      const out = await rt.run({ cwd, configRoot, prompt: "x", agent: over });
      return { status: out.status, calls, denied };
    };
    for (const root of [
      join(cwd, "cfg"),
      join(cwd, "cfg", "..", "cfg"),
      join(base, "link", "cfg"),
    ]) {
      expect(await attempt(root)).toEqual({ status: "misconfigured", calls: 0, denied: [] });
    }
    expect(await attempt(join(base, "sibling"))).toMatchObject({ status: "succeeded", calls: 1 });
    const forbidden = {
      ...agent,
      states: ["InReview" as const],
      tools: ["Read", "Write"] as AgentRunOptions["tools"],
    };
    expect(await attempt(join(base, "sibling"), forbidden)).toEqual({
      status: "misconfigured",
      calls: 0,
      denied: [],
    });
  });

  it("records permission denials once", async () => {
    const denial = { tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "ls" } };
    const denied: ToolDenied[] = [];
    const sink = { record: (d: ToolDenied) => denied.push(d) };
    const out = await new ClaudeAgentSdkRuntime({
      query: fakeQuery([init(), result({ permission_denials: [denial] })]),
      env: {},
      sink,
    }).run(makeRequest());
    expect(out.status).toBe("succeeded");
    expect(denied).toEqual([{ toolName: "Bash", toolUseId: "t1" }]);

    denied.length = 0;
    const query: QueryFn = async function* ({ options }) {
      const hook = options.hooks!.PreToolUse![0]!.hooks[0]!;
      await hook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "ls" },
          tool_use_id: "t1",
        } as never,
        "t1",
        { signal: new AbortController().signal },
      );
      yield init();
      yield result({ permission_denials: [denial] });
    };
    await new ClaudeAgentSdkRuntime({ query, env: {}, sink }).run(makeRequest());
    expect(denied).toEqual([{ toolName: "Bash", toolUseId: "t1" }]);
  });
});
