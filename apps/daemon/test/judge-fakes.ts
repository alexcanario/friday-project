import type { AgentRunRequest, AgentRuntime, CiStatus, GitHubPort } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import { FakeGitHub } from "./fakes.ts";
import { finished, verdict } from "./judge-dispatch-helpers.ts";

/** FakeGitHub with a configurable full CI status; records every call. */
export class FakeCiGitHub extends FakeGitHub {
  headSha = "a".repeat(40);
  readonly ciCalls: Array<[number, string]> = [];

  getCiStatus(pr: number, check: string): Promise<CiStatus> {
    this.ciCalls.push([pr, check]);
    return Promise.resolve({ headSha: this.headSha, state: "success" });
  }
}

/** Reviewer created with a token; records every posted review. */
export class FakeReviewer implements Pick<GitHubPort, "postReview"> {
  readonly token: string;
  readonly posted: Array<{
    pr: number;
    review: { commitId: string; body: string; event: string };
  }> = [];
  failure: Error | null = null;

  constructor(token: string) {
    this.token = token;
  }

  postReview(pr: number, review: { commitId: string; body: string; event: string }) {
    this.posted.push({ pr, review });
    return this.failure ? Promise.reject(this.failure) : Promise.resolve({ id: 501 });
  }
}

/** Counts calls and never resolves. */
export class CountingPendingRuntime implements AgentRuntime {
  calls = 0;

  run(): Promise<RunFinished> {
    this.calls += 1;
    return new Promise<RunFinished>(() => undefined);
  }
}

/** Runtime shared by the specialist run (issue 8, left pending) and the Judge (answered). */
export class SharedRuntime implements AgentRuntime {
  readonly requests: AgentRunRequest[] = [];
  #release: ((r: RunFinished) => void) | null = null;

  run(request: AgentRunRequest): Promise<RunFinished> {
    this.requests.push(request);
    if (request.agent.outputKind === "reviewVerdict") {
      return Promise.resolve(finished(verdict()));
    }
    return new Promise<RunFinished>((resolve) => {
      this.#release = resolve;
    });
  }

  releaseSpecialist(): void {
    this.#release?.(finished(null));
  }
}
