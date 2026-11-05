import { describe, expect, it } from "vitest";
import { contractJsonSchema } from "../src/json-schema.ts";
import type { ContractKind } from "../src/index.ts";

const kinds: ContractKind[] = [
  "qaReport",
  "reviewVerdict",
  "triage",
  "criteria",
  "workReport",
  "diagnosis",
];
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("contractJsonSchema", () => {
  it("emits draft-07 strict schemas for every kind", () => {
    for (const kind of kinds) {
      const s = contractJsonSchema(kind) as Obj;
      expect(s.$schema).toBe("http://json-schema.org/draft-07/schema#");
      expect(s.additionalProperties).toBe(false);
    }
  });

  it("keeps the field rules in the schemas", () => {
    const d = contractJsonSchema("diagnosis") as Obj;
    expect([...d.required].sort()).toEqual(
      [
        "issue_number",
        "root_cause",
        "evidence",
        "proposed_change",
        "risk",
        "affected_components",
        "load_relevant",
      ].sort(),
    );
    expect(d.required).not.toContain("jev_score");
    expect(d.properties.root_cause.minLength).toBe(20);
    expect(d.properties.evidence.minItems).toBe(1);
    expect(d.properties.issue_number.minimum).toBe(1);
    const c = contractJsonSchema("criteria") as Obj;
    const item = c.properties.criteria.items;
    expect(item.additionalProperties).toBe(false);
    const options = item.properties.proof.oneOf ?? item.properties.proof.anyOf;
    expect(options).toHaveLength(2);
    for (const o of options) expect(o.additionalProperties).toBe(false);
    const q = contractJsonSchema("qaReport") as Obj;
    const qi = q.properties.criteria.items;
    expect(qi.additionalProperties).toBe(false);
    expect(qi.required).not.toContain("how");
  });
});
