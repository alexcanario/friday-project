import { describe, expect, it } from "vitest";
import { criteriaSchema } from "../src/criteria.ts";
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

  it("accepts criteria in the triage output and leaves their validation to criteriaSchema", () => {
    const item = (index: number, claim: string) => ({
      index,
      claim,
      proof: { kind: "command", command: "pnpm -r test" },
    });
    const criteria = [item(1, "a"), item(2, "b")];
    const base = { specialist: "backend", reason: "API" };
    expect(validateContract("triage", { ...base, criteria }).ok).toBe(true);
    expect(validateContract("triage", base).ok).toBe(true);
    expect(validateContract("triage", { ...base, foo: 1 }).ok).toBe(false);
    expect(validateContract("triage", { specialist: "planner", reason: "API" }).ok).toBe(false);
    expect(criteriaSchema.safeParse({ criteria }).success).toBe(true);
    expect(criteriaSchema.safeParse({ criteria: [] }).success).toBe(false);
    expect(criteriaSchema.safeParse({ criteria: [item(2, "a")] }).success).toBe(false);
  });
});
