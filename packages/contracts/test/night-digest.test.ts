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
