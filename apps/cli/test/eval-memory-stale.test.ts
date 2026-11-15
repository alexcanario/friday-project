import { describe, expect, it } from "vitest";
import { createMemoryStaleVerdicts } from "../src/eval-memory-stale.ts";

const H = "a".repeat(40);
const OTHER = "b".repeat(40);

describe("createMemoryStaleVerdicts", () => {
  it("remembers stale verdicts per project, issue and head", () => {
    const stale = createMemoryStaleVerdicts();
    expect(stale.isStale("p", 1, H)).toBe(false);
    stale.markStale("p", 1, H);
    expect(stale.isStale("p", 1, H)).toBe(true);
    expect(stale.isStale("p", 1, OTHER)).toBe(false);
    expect(stale.isStale("p", 2, H)).toBe(false);
    expect(stale.isStale("q", 1, H)).toBe(false);
  });
});
