import { describe, expect, it } from "vitest";
import { nightDigestSchema } from "../src/night-digest.ts";

const valid = {
  reportIssue: 1,
  since: "2026-11-07T10:00:00Z",
  merges: [{ issue: 7, pr: 12, title: "feat: x (#7)" }],
  stuckPrs: [{ pr: 30, issue: 8, gates: ["gate:budget"], reason: "Teto estourado" }],
  nightStop: false,
  ready: [{ number: 3, title: "t" }],
  review: [],
  phases: { A: true, B: false },
};

describe("nightDigestSchema", () => {
  it("accepts a full digest and rejects extra keys and wrong types", () => {
    expect(nightDigestSchema.safeParse(valid).success).toBe(true);
    expect(nightDigestSchema.safeParse({ ...valid, since: null }).success).toBe(true);
    expect(nightDigestSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(nightDigestSchema.safeParse({ ...valid, nightStop: "yes" }).success).toBe(false);
    expect(nightDigestSchema.safeParse({ ...valid, phases: { A: true } }).success).toBe(false);
    expect(
      nightDigestSchema.safeParse({ ...valid, phases: { A: true, B: true, Z: true } }).success,
    ).toBe(false);
    expect(
      nightDigestSchema.safeParse({ ...valid, merges: [{ issue: 7, pr: "12", title: "x" }] })
        .success,
    ).toBe(false);
  });
});

describe("nightDigestSchema since", () => {
  const parse = (since: unknown) => nightDigestSchema.safeParse({ ...valid, since }).success;

  it("accepts an ISO 8601 UTC datetime", () => {
    expect(parse("2026-11-07T10:00:00Z")).toBe(true);
  });

  it("accepts null", () => {
    expect(parse(null)).toBe(true);
  });

  it("rejects values that are not ISO 8601 (incl. shell metacharacters)", () => {
    for (const bad of ["ontem", "2026-11-07", "2026-11-07T10:00:00Z; rm -rf /", "$(date)", ""]) {
      expect(parse(bad), bad).toBe(false);
    }
  });

  it("rejects an offset datetime", () => {
    expect(parse("2026-11-07T10:00:00+03:00")).toBe(false);
  });
});
