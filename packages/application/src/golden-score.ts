export type GoldenVerdict = "approve" | "changes_requested" | "reject";

export type GoldenResult = {
  itemId: string;
  verdict: GoldenVerdict;
  headSha: string;
  reviewedSha: string;
};

export type GoldenScore = {
  total: number;
  caught: number;
  rate: number;
  meetsTarget: boolean;
  missed: string[];
};

const TARGET_RATE = 0.7;

function isCatch(result: GoldenResult): boolean {
  return (
    (result.verdict === "changes_requested" || result.verdict === "reject") &&
    result.reviewedSha === result.headSha
  );
}

export function scoreGolden(
  plantedIds: readonly string[],
  results: readonly GoldenResult[],
): GoldenScore {
  const caughtIds = new Set(results.filter(isCatch).map((result) => result.itemId));
  const missed = plantedIds.filter((id) => !caughtIds.has(id));
  const total = plantedIds.length;
  const caught = total - missed.length;
  const rate = total === 0 ? 0 : caught / total;
  return { total, caught, rate, meetsTarget: total > 0 && rate >= TARGET_RATE, missed };
}
