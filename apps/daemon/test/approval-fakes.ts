import { FakeGitHub } from "./fakes.ts";

/** FakeGitHub that also answers getPrMergeState, kept apart because fakes.ts is over 300 lines. */
export class ApprovalFakeGitHub extends FakeGitHub {
  prMergeState: { merged: boolean; headSha: string } = { merged: false, headSha: "a".repeat(40) };
  mergeStateCalls: number[] = [];
  mergeStateFailure: Error | null = null;

  getPrMergeState(pr: number): Promise<{ merged: boolean; headSha: string }> {
    this.mergeStateCalls.push(pr);
    return this.mergeStateFailure === null
      ? Promise.resolve(this.prMergeState)
      : Promise.reject(this.mergeStateFailure);
  }
}
