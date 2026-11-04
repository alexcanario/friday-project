import { describe, expect, it } from "vitest";
import { validateContract } from "../src/validate.ts";
import { pairs } from "./helpers.ts";

const good = {
  issue_number: 142,
  root_cause: "Pool de conexões esgotado",
  evidence: ["timeout em 5xx após deploy"],
  proposed_change: "Aumentar o limite do pool",
  risk: "medium",
  affected_components: ["api"],
  load_relevant: false,
};

describe("diagnosis", () => {
  it("accepts the literal json with and without jev score", () => {
    expect(validateContract("diagnosis", good).ok).toBe(true);
    expect(validateContract("diagnosis", { ...good, jev_score: 0.91 }).ok).toBe(true);
  });

  it("returns the violations of the refused json", () => {
    const bad = {
      issue_number: 142,
      root_cause: "Bug",
      evidence: [],
      risk: "critical",
      merge: true,
    };
    expect(pairs("diagnosis", bad)).toEqual(
      [
        "unknown_field@merge",
        "invalid_value@root_cause",
        "invalid_value@evidence",
        "invalid_value@risk",
        "required_field@proposed_change",
        "required_field@affected_components",
        "required_field@load_relevant",
      ].sort(),
    );
  });

  it("applies rules 3, 4 and 7 one at a time", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ issue_number: 0 }, "issue_number"],
      [{ issue_number: 1.5 }, "issue_number"],
      [{ issue_number: "142" }, "issue_number"],
      [{ root_cause: "x".repeat(19) }, "root_cause"],
      [{ load_relevant: "false" }, "load_relevant"],
      [{ proposed_change: 1 }, "proposed_change"],
      [{ affected_components: "api" }, "affected_components"],
      [{ jev_score: "0.91" }, "jev_score"],
      [{ evidence: [1] }, "evidence.0"],
    ];
    for (const [change, path] of cases) {
      expect(pairs("diagnosis", { ...good, ...change })).toEqual([`invalid_value@${path}`]);
    }
    expect(validateContract("diagnosis", { ...good, root_cause: "x".repeat(20) }).ok).toBe(true);
    expect(validateContract("diagnosis", { ...good, proposed_change: "" }).ok).toBe(true);
  });
});
