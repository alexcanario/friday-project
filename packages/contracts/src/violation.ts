export type ViolationCode =
  | "unknown_field"
  | "required_field"
  | "invalid_value"
  | "evidence_missing"
  | "pass_without_criteria"
  | "pass_with_failed_criterion"
  | "invalid_head_sha"
  | "findings_missing"
  | "evidence_blank"
  | "invalid_rules"
  | "approve_with_failed_rule"
  | "unknown_kind"
  | "schema_invalid"
  | "json_invalid";

export interface Violation {
  code: ViolationCode;
  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; violations: Violation[] };

const templates: Record<ViolationCode, string> = {
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
  unknown_kind: 'Tipo de contrato desconhecido (kind): "<path>".',
  schema_invalid: "O valor deve ser um objeto JSON.",
  json_invalid: "O texto não é um JSON válido.",
};

export function violation(code: ViolationCode, path: string, detail = path): Violation {
  return { code, path, message: templates[code].replace("<path>", detail) };
}
