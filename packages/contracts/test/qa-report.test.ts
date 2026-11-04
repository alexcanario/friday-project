import { describe, expect, it } from "vitest";
import { validateContract } from "../src/index.ts";

const crit = (o: object = {}) => ({
  index: 1,
  result: "pass",
  how: "pnpm test exit 0",
  screenshots: [],
  ...o,
});
const pass = (o: object = {}) => ({ verdict: "pass", criteria: [crit()], notChecked: [], ...o });
const v = (code: string, path: string) => expect.objectContaining({ code, path });

function violations(value: unknown) {
  const r = validateContract("qaReport", value);
  if (r.ok) throw new Error("expected failure");
  return r.violations;
}

describe("qaReport", () => {
  it("accepts valid passing and failing reports", () => {
    expect(validateContract("qaReport", pass())).toEqual({ ok: true, value: pass() });
    const fail = {
      verdict: "fail",
      criteria: [crit({ result: "fail", how: "pnpm test exit 1" })],
      notChecked: ["Caminho do painel"],
    };
    expect(validateContract("qaReport", fail)).toEqual({ ok: true, value: fail });
  });

  it("rejects a field outside the contract", () => {
    expect(violations(pass({ merge: true }))).toEqual([
      {
        code: "unknown_field",
        path: "merge",
        message: "Campo não previsto no contrato (merge).",
      },
    ]);
    expect(violations(pass({ criteria: [crit({ extra: 1 })] }))).toEqual([
      v("unknown_field", "criteria.0.extra"),
    ]);
  });

  it("flags evidence_missing when a passing report has no how", () => {
    const { how: _how, ...noHow } = crit();
    void _how;
    expect(violations(pass({ criteria: [noHow] }))).toEqual([
      {
        code: "evidence_missing",
        path: "criteria.0.how",
        message: 'Relatório de QA com veredito pass exige "how" em cada critério (criteria.0.how).',
      },
    ]);
    expect(violations(pass({ criteria: [crit({ how: "   " })] }))).toEqual([
      v("evidence_missing", "criteria.0.how"),
    ]);
    expect(violations(pass({ criteria: [crit(), crit({ index: 2, how: "" })] }))).toEqual([
      v("evidence_missing", "criteria.1.how"),
    ]);
  });

  it("rejects missing keys and wrong values", () => {
    const { notChecked: _n, ...noNotChecked } = pass();
    void _n;
    expect(violations(noNotChecked)).toEqual([v("required_field", "notChecked")]);
    const { screenshots: _s, ...noShots } = crit();
    void _s;
    expect(violations(pass({ criteria: [noShots] }))).toEqual([
      v("required_field", "criteria.0.screenshots"),
    ]);
    expect(violations(pass({ verdict: "maybe" }))).toEqual([v("invalid_value", "verdict")]);
    expect(violations(pass({ criteria: [crit({ index: "1" })] }))).toEqual([
      v("invalid_value", "criteria.0.index"),
    ]);
  });

  it("keeps a passing report coherent with its criteria", () => {
    expect(violations(pass({ criteria: [] }))).toEqual([v("pass_without_criteria", "criteria")]);
    expect(violations(pass({ criteria: [crit({ result: "fail" })] }))).toEqual([
      v("pass_with_failed_criterion", "criteria.0.result"),
    ]);
    const ok = { verdict: "fail", criteria: [crit({ result: "fail", how: "" })], notChecked: [] };
    expect(validateContract("qaReport", ok).ok).toBe(true);
  });
});
