import type { RunFinished } from "@friday/contracts";
import type { AgentRuntime, AgentRunRequest } from "./agent-runtime.ts";

export class FakeAgentRuntime implements AgentRuntime {
  readonly requests: AgentRunRequest[] = [];
  readonly #results: RunFinished[];

  constructor(results: RunFinished[]) {
    this.#results = [...results];
  }

  run(request: AgentRunRequest): Promise<RunFinished> {
    this.requests.push(request);
    const next = this.#results.shift();
    if (next === undefined) return Promise.reject(new Error("FakeAgentRuntime sem resultado"));
    return Promise.resolve(next);
  }
}
