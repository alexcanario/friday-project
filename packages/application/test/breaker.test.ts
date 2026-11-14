import { describe, expect, it } from "vitest";
import { BREAKER_OPEN_MS } from "../src/index.ts";

describe("breaker constants", () => {
  it("exposes the breaker open duration as 1_800_000 ms", () => {
    expect(BREAKER_OPEN_MS).toBe(1_800_000);
  });
});
