import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import * as api from "../src/index.ts";
import {
  parseAndValidateContract,
  validateContract,
  type QaReport,
  type ReviewVerdict,
  type ValidationResult,
  type Violation,
} from "../src/index.ts";

const qa = {
  verdict: "pass",
  criteria: [{ index: 1, result: "pass", how: "pnpm test exit 0", screenshots: [] }],
  notChecked: [],
};
const MESSAGES: Record<string, string> = {
  unknown_field: "Campo não previsto no contrato (<path>).",
  required_field: "Campo obrigatório ausente (<path>).",
  invalid_value: "Valor inválido (<path>).",
  evidence_missing: 'Relatório de QA com veredito pass exige "how" em cada critério (<path>).',
  pass_without_criteria: "Relatório de QA com veredito pass exige ao menos um critério (criteria).",
  pass_with_failed_criterion:
    "Relatório de QA com veredito pass não aceita critério reprovado (<path>).",
  invalid_head_sha: "headSha deve ter 40 caracteres hexadecimais minúsculos (headSha).",
  findings_missing: "Veredito changes_requested ou reject exige ao menos um finding (findings).",
  evidence_blank: "Regra do veredito exige evidência (<path>).",
  invalid_rules: "rules deve ter exatamente 5 entradas, uma para cada regra de 1 a 5 (rules).",
  approve_with_failed_rule: 'Veredito approve não é aceito com regra respondida "no" (verdict).',
  schema_invalid: "O valor deve ser um objeto JSON.",
};

describe("validateContract", () => {
  it("returns schema_invalid and unknown_kind without throwing", () => {
    for (const kind of ["qaReport", "reviewVerdict"] as const) {
      for (const value of [null, "texto", 42, []]) {
        expect(validateContract(kind, value)).toEqual({
          ok: false,
          violations: [
            { code: "schema_invalid", path: "", message: "O valor deve ser um objeto JSON." },
          ],
        });
      }
    }
    expect(validateContract("inexistente" as never, {})).toEqual({
      ok: false,
      violations: [
        {
          code: "unknown_kind",
          path: "kind",
          message: 'Tipo de contrato desconhecido (kind): "inexistente".',
        },
      ],
    });
  });

  it("returns json_invalid for malformed text and delegates valid text", () => {
    expect(parseAndValidateContract("qaReport", "{nao e json")).toEqual({
      ok: false,
      violations: [{ code: "json_invalid", path: "", message: "O texto não é um JSON válido." }],
    });
    expect(parseAndValidateContract("qaReport", JSON.stringify(qa))).toEqual({
      ok: true,
      value: qa,
    });
    const arr = parseAndValidateContract("qaReport", "[]");
    expect(!arr.ok && arr.violations[0]?.code).toBe("schema_invalid");
    const extra = { ...qa, merge: true };
    expect(parseAndValidateContract("qaReport", JSON.stringify(extra))).toEqual(
      validateContract("qaReport", extra),
    );
  });

  it("every violation has the fixed pt-BR message and contains its path", () => {
    const sha = "c71e0a94d2b6f8531e7a9c4d0b2f6e8a1c3d5b7f";
    const r = (n: number) => ({ rule: n, answer: "yes", evidence: "ok" });
    const rv = {
      verdict: "approve",
      headSha: sha,
      rules: [1, 2, 3, 4, 5].map(r),
      findings: [],
      risk: "low",
    };
    const cases: Array<["qaReport" | "reviewVerdict", unknown]> = [
      ["qaReport", { ...qa, merge: true }],
      ["qaReport", { verdict: qa.verdict, criteria: qa.criteria }],
      ["qaReport", { ...qa, verdict: "maybe" }],
      ["qaReport", { ...qa, criteria: [{ ...qa.criteria[0], how: " " }] }],
      ["qaReport", { ...qa, criteria: [] }],
      ["qaReport", { ...qa, criteria: [{ ...qa.criteria[0], result: "fail" }] }],
      ["reviewVerdict", { ...rv, headSha: "abc" }],
      ["reviewVerdict", { ...rv, verdict: "reject" }],
      ["reviewVerdict", { ...rv, rules: [1, 2, 3, 4, 5].map((n) => ({ ...r(n), evidence: " " })) }],
      ["reviewVerdict", { ...rv, rules: [r(1)] }],
      ["reviewVerdict", { ...rv, rules: [1, 2, 3, 4, 5].map((n) => ({ ...r(n), answer: "no" })) }],
    ];
    const seen = new Set<string>();
    for (const [kind, value] of cases) {
      const res = validateContract(kind, value);
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      for (const x of res.violations) {
        seen.add(x.code);
        const tpl = MESSAGES[x.code];
        expect(tpl, x.code).toBeDefined();
        expect(x.message).toBe((tpl as string).replaceAll("<path>", x.path));
        if (x.path !== "") expect(x.message).toContain(x.path);
      }
    }
    for (const code of Object.keys(MESSAGES)) {
      if (code !== "schema_invalid") expect([...seen], code).toContain(code);
    }
  });

  it("package index exports the public API", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "AGENT_STATES",
        "BUILTIN_TOOLS",
        "MCP_TOOLS",
        "RUN_STATUSES",
        "agentConfigSchema",
        "factoryConfigSchema",
        "contractJsonSchema",
        "criteriaSchema",
        "diagnosisSchema",
        "parseAndValidateContract",
        "qaReportSchema",
        "reviewVerdictSchema",
        "runFinishedSchema",
        "triageSchema",
        "validateContract",
        "workReportSchema",
      ].sort(),
    );
    const q: QaReport = qa as QaReport;
    const rv: ReviewVerdict["verdict"] = "approve";
    const viol: Violation = { code: "json_invalid", path: "", message: "" };
    const res: ValidationResult<QaReport> = { ok: false, violations: [viol] };
    expect([q.verdict, rv, res.ok]).toBeDefined();
  });
});

describe("validateContract robustness", () => {
  afterEach(() => {
    z.config(z.locales.en());
  });

  it("keeps required_field when Zod uses another locale or a custom error map", () => {
    z.config({ localeError: () => "mensagem sem o texto padrao" });
    const result = validateContract("qaReport", { verdict: "pass", notChecked: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.map((x) => [x.code, x.path])).toContainEqual([
        "required_field",
        "criteria",
      ]);
    }
  });

  it("reports invalid_value for a present value of the wrong type", () => {
    z.config({ localeError: () => "mensagem sem o texto padrao" });
    const result = validateContract("qaReport", {
      verdict: "pass",
      criteria: null,
      notChecked: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.map((x) => [x.code, x.path])).toContainEqual([
        "invalid_value",
        "criteria",
      ]);
    }
  });

  it("does not let replacement patterns in the key deform the message", () => {
    const result = validateContract("qaReport", { ...qa, "$&": 1 });
    expect(result).toEqual({
      ok: false,
      violations: [
        {
          code: "unknown_field",
          path: "$&",
          message: "Campo não previsto no contrato ($&).",
        },
      ],
    });
  });
});

describe("missing enum keys", () => {
  it("classifies a missing verdict as required_field for qaReport and reviewVerdict", () => {
    const qaNoVerdict: Record<string, unknown> = { ...qa };
    delete qaNoVerdict.verdict;
    const res = validateContract("qaReport", qaNoVerdict);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.violations).toContainEqual(
        expect.objectContaining({ code: "required_field", path: "verdict" }),
      );
    }
    const rv = validateContract("reviewVerdict", { findings: [] });
    expect(rv.ok).toBe(false);
    if (!rv.ok) {
      expect(rv.violations).toContainEqual(
        expect.objectContaining({ code: "required_field", path: "verdict" }),
      );
    }
  });

  it("classifies a nested missing enum key as required_field", () => {
    const criterion: Record<string, unknown> = { ...qa.criteria[0] };
    delete criterion.result;
    const res = validateContract("qaReport", { ...qa, criteria: [criterion] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.violations).toContainEqual(
        expect.objectContaining({ code: "required_field", path: "criteria.0.result" }),
      );
    }
  });

  it("keeps invalid_value for a present but wrong enum value", () => {
    const res = validateContract("qaReport", { ...qa, verdict: "talvez" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.violations).toContainEqual(
        expect.objectContaining({ code: "invalid_value", path: "verdict" }),
      );
    }
  });
});
