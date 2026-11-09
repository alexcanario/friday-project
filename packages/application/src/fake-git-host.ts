import type { GitHost } from "./git-host.ts";

type PushRequest = Parameters<GitHost["push"]>[0];

export class FakeGitHost implements GitHost {
  readonly pushes: PushRequest[] = [];
  readonly #fail: Error | undefined;
  readonly #sha: string;

  constructor(options?: { fail?: Error; sha?: string }) {
    this.#fail = options?.fail;
    this.#sha = options?.sha ?? "0".repeat(40);
  }

  push(request: PushRequest): Promise<{ sha: string }> {
    this.pushes.push(request);
    return this.#fail ? Promise.reject(this.#fail) : Promise.resolve({ sha: this.#sha });
  }
}
