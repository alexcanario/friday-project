import { describe, expect, it } from "vitest";
import { validateContract } from "../src/index.ts";

const SHA = "c71e0a94d2b6f8531e7a9c4d0b2f6e8a1c3d5b7f";
const rule = (n: number, answer = "yes") => ({ rule: n, answer, evidence: "npm test exit 0" });
const rules = (order = [1, 2, 3, 4, 5]) => order.map((n) => rule(n));
const approve = (o: object = {}) => ({
  verdict: "approve",
  headSha: SHA,
  rules: rules(),
  findings: [],
  ...o,
});
const v = (code: string, path: string) => expect.objectContaining({ code, path });

function violations(value: unknown) {
  const r = validateContract("reviewVerdict", value);
  if (r.ok) throw new Error("expected failure");
  return r.violations;
}

describe("reviewVerdict", () => {
  it("accepts an approve verdict with five rules in any order", () => {
    expect(validateContract("reviewVerdict", approve())).toEqual({ ok: true, value: approve() });
    expect(validateContract("reviewVerdict", approve({ rules: rules([5, 4, 3, 2, 1]) })).ok).toBe(
      true,
    );
  });

  it("accepts changes_requested and reject with findings", () => {
    const base = {
      headSha: "9f2c4e1a7b3d5c0e8a6f4b2d9c1e3a5b7d0f2c4e",
      rules: [rule(1), rule(2), rule(3, "no"), rule(4), rule(5)],
    };
    const a = {
      ...base,
      verdict: "changes_requested",
      findings: ["Falta teste para o limite do pool", "Timeout fixo, sem configuração"],
    };
    expect(validateContract("reviewVerdict", a).ok).toBe(true);
    expect(
      validateContract("reviewVerdict", {
        ...base,
        verdict: "reject",
        findings: ["Fora do escopo."],
      }).ok,
    ).toBe(true);
  });

  it("refuses approve when a rule is answered no", () => {
    const r = [rule(1), rule(2), rule(3), rule(4, "no"), rule(5)];
    expect(violations(approve({ rules: r }))).toEqual([
      {
        code: "approve_with_failed_rule",
        path: "verdict",
        message: 'Veredito approve não é aceito com regra respondida "no" (verdict).',
      },
    ]);
  });

  it("rejects a headSha that is not 40 hex characters", () => {
    for (const headSha of [SHA.slice(1), SHA + "a", "g" + SHA.slice(1), SHA.toUpperCase()]) {
      expect(violations(approve({ headSha }))).toEqual([
        {
          code: "invalid_head_sha",
          path: "headSha",
          message: "headSha deve ter 40 caracteres hexadecimais minúsculos (headSha).",
        },
      ]);
    }
    const { headSha: _h, ...noSha } = approve();
    void _h;
    expect(violations(noSha)).toEqual([v("required_field", "headSha")]);
  });

  it("rejects rules that are not exactly 1 to 5", () => {
    const bad = [
      rules([1, 2, 3, 4]),
      rules([1, 2, 3, 4, 5, 5]),
      rules([1, 1, 2, 3, 4]),
      [1, 2, 3, 4, 6].map((n) => ({ rule: n, answer: "yes", evidence: "ok" })),
    ];
    for (const r of bad) {
      expect(violations(approve({ rules: r }))).toEqual([
        {
          code: "invalid_rules",
          path: "rules",
          message: "rules deve ter exatamente 5 entradas, uma para cada regra de 1 a 5 (rules).",
        },
      ]);
    }
    const { rules: _r, ...noRules } = approve();
    void _r;
    expect(violations(noRules)).toEqual([v("required_field", "rules")]);
    const r = rules();
    r[0] = rule(1, "maybe");
    expect(violations(approve({ rules: r }))).toEqual([v("invalid_value", "rules.0.answer")]);
  });

  it("rejects unknown field and unknown verdict", () => {
    expect(violations(approve({ merge: true }))).toEqual([v("unknown_field", "merge")]);
    expect(violations(approve({ verdict: "maybe" }))).toEqual([v("invalid_value", "verdict")]);
  });

  it("requires findings when not approving and evidence on every rule", () => {
    for (const verdict of ["changes_requested", "reject"]) {
      expect(violations(approve({ verdict, findings: [] }))).toEqual([
        v("findings_missing", "findings"),
      ]);
    }
    expect(validateContract("reviewVerdict", approve({ findings: ["Nota."] })).ok).toBe(true);
    const r = rules();
    r[2] = { rule: 3, answer: "yes", evidence: "   " };
    expect(violations(approve({ rules: r }))).toEqual([v("evidence_blank", "rules.2.evidence")]);
    expect(violations(approve({ verdict: "reject", findings: ["x"], rules: r }))).toEqual([
      v("evidence_blank", "rules.2.evidence"),
    ]);
  });
});
