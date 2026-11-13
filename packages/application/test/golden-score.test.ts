import { describe, expect, it } from "vitest";
import { scoreGolden, type GoldenResult, type GoldenVerdict } from "../src/index.ts";

const r = (itemId: string, verdict: GoldenVerdict, reviewedSha = "a1"): GoldenResult => ({
  itemId,
  verdict,
  headSha: "a1",
  reviewedSha,
});

describe("scoreGolden", () => {
  it("scores 3 of 4 planted defects caught", () => {
    const score = scoreGolden(
      ["S1", "S2", "S3", "S4"],
      [
        r("S1", "changes_requested"),
        r("S2", "reject"),
        r("S3", "approve"),
        r("S4", "changes_requested"),
      ],
    );
    expect(score).toEqual({ total: 4, caught: 3, rate: 0.75, meetsTarget: true, missed: ["S3"] });
  });

  it("counts approve and a verdict bound to another SHA as missed", () => {
    expect(scoreGolden(["S1", "S2"], [r("S1", "approve"), r("S2", "approve")])).toEqual({
      total: 2,
      caught: 0,
      rate: 0,
      meetsTarget: false,
      missed: ["S1", "S2"],
    });
    const stale = scoreGolden(["S1"], [r("S1", "changes_requested", "b2")]);
    expect(stale.missed).toEqual(["S1"]);
  });

  it("meetsTarget is true at 0.7 and false at 0.6", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `S${i}`);
    const caught = (n: number) => ids.slice(0, n).map((id) => r(id, "reject"));
    expect(scoreGolden(ids, caught(7))).toMatchObject({ rate: 0.7, meetsTarget: true });
    expect(scoreGolden(ids, caught(6))).toMatchObject({ rate: 0.6, meetsTarget: false });
  });

  it("ignores unknown ids, dedups, handles empty planted list and keeps missed order", () => {
    expect(scoreGolden(["S1"], [r("X9", "reject")])).toMatchObject({ total: 1, caught: 0 });
    expect(scoreGolden(["S1"], [r("S1", "approve"), r("S1", "reject")])).toMatchObject({
      total: 1,
      caught: 1,
    });
    expect(scoreGolden([], [r("S1", "reject")])).toEqual({
      total: 0,
      caught: 0,
      rate: 0,
      meetsTarget: false,
      missed: [],
    });
    expect(scoreGolden(["S3", "S1"], []).missed).toEqual(["S3", "S1"]);
  });
});
