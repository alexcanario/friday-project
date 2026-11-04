import { describe, expect, it } from "vitest";
import { validateContract } from "../src/validate.ts";
import { pairs } from "./helpers.ts";

const cmd = (index: number) => ({
  index,
  claim: "c",
  proof: { kind: "command", command: "pnpm t" },
});
const br = (index: number) => ({ index, claim: "c", proof: { kind: "browser", step: "abrir" } });
const withProof = (proof: unknown) => ({ criteria: [{ index: 1, claim: "c", proof }] });
const FIXED = "Os índices de critérios devem ser 1, 2, 3… na ordem da lista (criteria).";

describe("criteria", () => {
  it("requires sequential criteria with a claim", () => {
    expect(validateContract("criteria", { criteria: [cmd(1), br(2)] }).ok).toBe(true);
    expect(pairs("criteria", { criteria: [] })).toEqual(["invalid_value@criteria"]);
    for (const [a, b] of [
      [1, 3],
      [2, 1],
      [2, 3],
      [0, 1],
    ] as const) {
      const r = validateContract("criteria", { criteria: [cmd(a), cmd(b)] });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.violations).toEqual([
          { code: "invalid_criteria_index", path: "criteria", message: FIXED },
        ]);
      }
    }
    expect(pairs("criteria", { criteria: [cmd(1.5)] })).toEqual(["invalid_value@criteria.0.index"]);
    expect(pairs("criteria", { criteria: [{ ...cmd(1), claim: "  " }] })).toEqual([
      "invalid_value@criteria.0.claim",
    ]);
  });

  it("validates the proof by kind", () => {
    const p = "criteria.0.proof";
    expect(pairs("criteria", withProof({ command: "x" }))).toEqual([`required_field@${p}.kind`]);
    expect(pairs("criteria", withProof({ kind: "other" }))).toEqual([`invalid_value@${p}.kind`]);
    expect(pairs("criteria", withProof({ kind: "command" }))).toEqual([
      `required_field@${p}.command`,
    ]);
    expect(pairs("criteria", withProof({ kind: "command", command: "x", step: "y" }))).toEqual([
      `unknown_field@${p}.step`,
    ]);
    for (const command of ["", " "]) {
      expect(pairs("criteria", withProof({ kind: "command", command }))).toEqual([
        `invalid_value@${p}.command`,
      ]);
    }
    expect(pairs("criteria", withProof({ kind: "browser" }))).toEqual([`required_field@${p}.step`]);
    expect(pairs("criteria", withProof({ kind: "browser", step: " " }))).toEqual([
      `invalid_value@${p}.step`,
    ]);
  });
});
