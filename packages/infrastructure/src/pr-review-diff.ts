import { MAX_REVIEW_PATCH_BYTES, type PrReviewDiff } from "@friday/application";

type ApiFile = {
  filename: string;
  previous_filename?: string | undefined;
  additions: number;
  deletions: number;
  patch?: string | undefined;
};

/** Maps the files of the GitHub API to the review diff, cutting patch text beyond the byte cap (D95). */
export function toPrReviewDiff(headSha: string, files: readonly ApiFile[]): PrReviewDiff {
  let used = 0;
  let truncated = false;
  const mapped = files.map((f) => {
    const entry: PrReviewDiff["files"][number] = {
      path: f.filename,
      changedLines: f.additions + f.deletions,
      hasPatch: f.patch !== undefined,
    };
    if (f.previous_filename !== undefined) entry.previousPath = f.previous_filename;
    if (f.patch === undefined) return entry;
    const size = Buffer.byteLength(f.patch, "utf8");
    // Once one patch overflows, every later one is cut too, so the result stays a clean prefix.
    if (truncated || used + size > MAX_REVIEW_PATCH_BYTES) {
      truncated = true;
      return entry;
    }
    used += size;
    entry.patch = f.patch;
    return entry;
  });
  return { headSha, truncated, files: mapped };
}
