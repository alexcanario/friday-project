import type { CiStatus, CreatedPr, GitHubPort, IssueSummary, MergeResult } from "./github-port.ts";
import type { PrDiff } from "./pr-diff.ts";

const missing = (method: string): Promise<never> =>
  Promise.reject(new Error(`não implementado: ${method}`));

export class FakeGitHubPort implements GitHubPort {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  readonly #createdPr: CreatedPr;
  readonly #prDiff: PrDiff;
  readonly #fail: Error | undefined;

  constructor(options?: { createdPr?: CreatedPr; prDiff?: PrDiff; fail?: Error }) {
    this.#createdPr = options?.createdPr ?? { number: 1, headSha: "a".repeat(40), created: true };
    this.#prDiff = options?.prDiff ?? { files: [], diffBytes: 0 };
    this.#fail = options?.fail;
  }

  #record<T>(method: string, args: unknown[], value: T): Promise<T> {
    this.calls.push({ method, args });
    return this.#fail ? Promise.reject(this.#fail) : Promise.resolve(value);
  }

  createPullRequest(input: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<CreatedPr> {
    return this.#record("createPullRequest", [input], this.#createdPr);
  }

  getPrDiff(pr: number): Promise<PrDiff> {
    return this.#record("getPrDiff", [pr], this.#prDiff);
  }

  postAgentComment(issue: number, role: string, text: string): Promise<{ created: boolean }> {
    return this.#record("postAgentComment", [issue, role, text], { created: true });
  }

  listIssuesByLabel(): Promise<IssueSummary[]> {
    return missing("listIssuesByLabel");
  }
  addLabel(): Promise<void> {
    return missing("addLabel");
  }
  removeLabel(): Promise<void> {
    return missing("removeLabel");
  }
  getCiStatus(): Promise<CiStatus> {
    return missing("getCiStatus");
  }
  squashMerge(): Promise<MergeResult> {
    return missing("squashMerge");
  }
}
