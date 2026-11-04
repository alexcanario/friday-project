import { describe, expect, it } from "vitest";
import { validateContract } from "../src/validate.ts";
import { pairs } from "./helpers.ts";

describe("triage", () => {
  it("accepts a known specialist and rejects the rest", () => {
    for (const specialist of ["backend", "database", "frontend", "infra", "security"]) {
      expect(validateContract("triage", { specialist, reason: "API" }).ok).toBe(true);
    }
    expect(pairs("triage", { specialist: "planner", reason: "API" })).toEqual([
      "invalid_value@specialist",
    ]);
    expect(pairs("triage", { specialist: "infra", reason: "   " })).toEqual([
      "invalid_value@reason",
    ]);
    expect(pairs("triage", { specialist: "infra" })).toEqual(["required_field@reason"]);
    expect(pairs("triage", { specialist: "infra", reason: "x", extra: 1 })).toEqual([
      "unknown_field@extra",
    ]);
  });
});
