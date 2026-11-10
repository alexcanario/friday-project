export type PrDiff = {
  files: { path: string; changedLines: number; hasPatch: boolean }[];
  diffBytes: number;
};

export class PrDiffTruncatedError extends Error {
  readonly code = "diff_truncated";
  override readonly name = "PrDiffTruncatedError";
  readonly expected: number;
  readonly received: number;

  constructor(expected: number, received: number) {
    super(`Diff do PR incompleto: esperados ${expected} arquivos, recebidos ${received}.`);
    this.expected = expected;
    this.received = received;
  }
}
