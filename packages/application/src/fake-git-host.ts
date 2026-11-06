import type { GitHost } from "./git-host.ts";

export class FakeGitHost implements GitHost {
  readonly pushes: Array<{ worktree: string; branch: string; commit: string }> = [];
  readonly #fail: Error | undefined;

  constructor(options?: { fail?: Error }) {
    this.#fail = options?.fail;
  }

  push(request: { worktree: string; branch: string; commit: string }): Promise<void> {
    this.pushes.push(request);
    return this.#fail ? Promise.reject(this.#fail) : Promise.resolve();
  }
}
