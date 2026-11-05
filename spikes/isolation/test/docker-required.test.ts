import { describe, expect, it } from "vitest";
import { dockerAvailable } from "./helpers.ts";

describe("docker requirement", () => {
  it("fails when docker is missing in CI", () => {
    if (process.env.CI !== "true") return;
    expect(dockerAvailable()).toBe(true);
  });
});
