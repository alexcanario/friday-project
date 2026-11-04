import { describe, expect, it } from "vitest";
import { parseAndValidateContract, validateContract } from "../src/validate.ts";

describe("new kinds", () => {
  it("never throws on the new kinds", () => {
    for (const kind of ["triage", "criteria", "workReport", "diagnosis"] as const) {
      for (const value of [null, undefined, "x", [], 1]) {
        const r = validateContract(kind, value);
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.violations.map((v) => [v.code, v.path])).toEqual([["schema_invalid", ""]]);
        }
      }
    }
    const r = parseAndValidateContract("diagnosis", "{");
    expect(!r.ok && r.violations[0]?.code).toBe("json_invalid");
  });
});
