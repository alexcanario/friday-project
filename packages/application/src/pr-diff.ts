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

/** Diff shown to the Judge and to agents through pr_diff: the head SHA plus the patch text (D95). */
export type PrReviewDiff = {
  headSha: string;
  truncated: boolean;
  files: {
    path: string;
    changedLines: number;
    hasPatch: boolean;
    patch?: string;
    previousPath?: string;
  }[];
};

/** Cap on the UTF-8 bytes of patch text one pr_diff call returns; below the MCP tool output limit (D95). */
export const MAX_REVIEW_PATCH_BYTES = 40000;
