import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { query as sdkQuery, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRuntime, AgentRunRequest, ToolDenialSink } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import { isInside, resolveReal } from "./config-root-guard.ts";
import { dedupeDenials } from "./denial-dedup.ts";
import { buildQueryOptions } from "./query-options.ts";
import { buildRunEnv } from "./run-env.ts";
import { buildToolPolicy } from "./tool-policy.ts";
import { classify, emptyFinished, type RunObservation } from "./run-result.ts";

type QueryFn = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export interface ClaudeAgentSdkRuntimeDeps {
  query?: QueryFn;
  env?: Record<string, string | undefined>;
  sink?: ToolDenialSink;
}

export class ClaudeAgentSdkRuntime implements AgentRuntime {
  readonly #query: QueryFn;
  readonly #env: Record<string, string | undefined>;
  readonly #sink: ToolDenialSink;

  constructor(deps: ClaudeAgentSdkRuntimeDeps = {}) {
    this.#query = deps.query ?? sdkQuery;
    this.#env = deps.env ?? process.env;
    this.#sink = deps.sink ?? { record: () => undefined };
  }

  async run(request: AgentRunRequest): Promise<RunFinished> {
    const configRoot = resolveReal(request.configRoot);
    if (isInside(request.cwd, configRoot)) return emptyFinished("misconfigured", null);
    const built = buildToolPolicy(request.agent, request.cwd);
    if (!built.ok) return emptyFinished("misconfigured", null);
    const sink = dedupeDenials(this.#sink);
    let systemPromptAppend: string;
    try {
      systemPromptAppend = await readFile(join(configRoot, request.agent.promptFile), "utf8");
    } catch {
      return emptyFinished("misconfigured", null);
    }
    const abortController = new AbortController();
    const obs: RunObservation = {
      model: null,
      initSeen: false,
      toolViolation: false,
      result: null,
      timedOut: false,
    };
    const timer = setTimeout(() => {
      obs.timedOut = true;
      abortController.abort();
    }, request.agent.timeoutMs);
    try {
      const options = buildQueryOptions({
        request,
        env: buildRunEnv(this.#env),
        systemPromptAppend,
        abortController,
        policy: built.policy,
        sink,
      });
      await this.#consume(
        this.#query({ prompt: request.prompt, options }),
        request,
        obs,
        abortController,
        sink,
      );
    } catch {
      // The SDK throws after delivering an error result; the classification uses what was seen.
    } finally {
      clearTimeout(timer);
    }
    return classify(obs, request.agent);
  }

  async #consume(
    messages: AsyncIterable<SDKMessage>,
    request: AgentRunRequest,
    obs: RunObservation,
    abortController: AbortController,
    sink: ToolDenialSink,
  ): Promise<void> {
    const permitted = new Set([
      ...request.agent.tools,
      ...request.agent.allowedTools,
      "StructuredOutput",
    ]);
    for await (const message of messages) {
      if (message.type === "system" && message.subtype === "init") {
        // An init that arrives after a result does not count: order matters.
        if (obs.result === null) obs.initSeen = true;
        obs.model = message.model;
        if (message.tools.some((tool) => !permitted.has(tool))) {
          obs.toolViolation = true;
          abortController.abort();
          return;
        }
      } else if (message.type === "result") {
        obs.result = message;
        for (const d of message.permission_denials ?? []) {
          try {
            sink.record({ toolName: d.tool_name, toolUseId: d.tool_use_id });
          } catch {
            // A failing sink must not hide the remaining denials or the result.
          }
        }
      }
    }
  }
}
