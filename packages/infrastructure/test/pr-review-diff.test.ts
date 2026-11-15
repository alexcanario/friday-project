import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toPrReviewDiff } from "../src/pr-review-diff.ts";

const file = (filename: string, size: number) => ({
  filename,
  additions: 1,
  deletions: 0,
  patch: "x".repeat(size),
});
const sized = (sizes: number[]) => sizes.map((n, i) => file(`f${i + 1}.ts`, n));

describe("toPrReviewDiff patch cut (D110)", () => {
  it("skips only the overflowing patch and keeps the small one after it", () => {
    const r = toPrReviewDiff("sha", sized([39000, 2000, 1]));
    expect(r.truncated).toBe(true);
    expect(r.files[0]?.patch).toHaveLength(39000);
    expect(r.files[1]).toEqual({ path: "f2.ts", changedLines: 1, hasPatch: true });
    expect("patch" in (r.files[1] ?? {})).toBe(false);
    expect(r.files[2]?.patch).toBe("x");
  });

  it("accepts a patch that fills the cap exactly and skips the next that overflows", () => {
    const r = toPrReviewDiff("sha", sized([39000, 2000, 1000, 1001]));
    expect(r.truncated).toBe(true);
    expect(r.files[0]?.patch).toBeDefined();
    expect(r.files[2]?.patch).toBeDefined();
    expect(r.files[1]?.patch).toBeUndefined();
    expect(r.files[3]?.patch).toBeUndefined();
    const total = r.files.reduce((s, f) => s + Buffer.byteLength(f.patch ?? "", "utf8"), 0);
    expect(total).toBeLessThanOrEqual(40000);
  });

  it("measures UTF-8 bytes: 20000 multibyte chars fit", () => {
    const r = toPrReviewDiff("sha", [{ ...file("f1.ts", 0), patch: "ç".repeat(20000) }]);
    expect(r.truncated).toBe(false);
    expect(r.files[0]?.patch).toBeDefined();
  });

  it("measures UTF-8 bytes: 20001 multibyte chars overflow", () => {
    const r = toPrReviewDiff("sha", [{ ...file("f1.ts", 0), patch: "ç".repeat(20001) }]);
    expect(r.truncated).toBe(true);
    expect(r.files[0]?.patch).toBeUndefined();
    expect(r.files[0]?.hasPatch).toBe(true);
  });

  it("keeps truncated false when everything fits", () => {
    const r = toPrReviewDiff("sha", sized([25000, 15000]));
    expect(r.truncated).toBe(false);
    expect(r.files.every((f) => f.patch !== undefined)).toBe(true);
    expect(toPrReviewDiff("sha", [])).toEqual({ headSha: "sha", truncated: false, files: [] });
  });

  it("does not count files without patch", () => {
    const r = toPrReviewDiff("sha", [
      file("f1.ts", 39000),
      { filename: "img.png", additions: 0, deletions: 0 },
      file("f3.ts", 1000),
    ]);
    expect(r.truncated).toBe(false);
    expect(r.files[1]).toEqual({ path: "img.png", changedLines: 0, hasPatch: false });
    expect(r.files[0]?.patch).toBeDefined();
    expect(r.files[2]?.patch).toBeDefined();
  });

  it("decisions.md records D110 for the patch cut", () => {
    const text = readFileSync(new URL("../../../docs/decisions.md", import.meta.url), "utf8");
    const row = text.split("\n").find((l) => l.startsWith("| D110 |"));
    expect(row).toBeDefined();
    expect(row).toContain("#416");
  });
});
